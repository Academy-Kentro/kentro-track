import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { ErroApi } from '../comum/erros';
import { Fetch, FETCH } from '../comum/fetch';
import { PrismaService } from '../comum/prisma.service';
import { ClienteGraph } from '../meta/cliente/graph';
import { ConexaoService } from '../meta/conexao/conexao.service';
import { PainelService } from './painel.service';

const CACHE_MS = 6 * 60 * 60_000;
const MAX_CACHE = 300;
const MAX_BYTES = 2 * 1024 * 1024;

interface Imagem {
  tipo: string;
  bytes: Buffer;
  ate: number;
}

/**
 * Miniatura do criativo pelo nosso domínio: a URL do Meta expira em dias e o iframe da Kentro
 * não manda cabeçalho nenhum num <img>. A assinatura na URL impede listar anúncios de outra conta.
 */
@Controller('m')
export class MidiaController {
  private readonly cache = new Map<string, Imagem>();

  constructor(
    private readonly painel: PainelService,
    private readonly prisma: PrismaService,
    private readonly graph: ClienteGraph,
    private readonly conexao: ConexaoService,
    @Inject(FETCH) private readonly fetch: Fetch,
  ) {}

  @Get(':referencia')
  @SkipThrottle()
  async servir(@Param('referencia') referencia: string, @Res() res: Response): Promise<void> {
    const naoEncontrada = new ErroApi(404, 'NAO_ENCONTRADO', 'Imagem não encontrada.');
    const id = this.painel.conferirMidia(referencia);
    if (!id) throw naoEncontrada;

    let imagem = this.cache.get(id);
    if (!imagem || imagem.ate < Date.now()) {
      imagem = (await this.buscar(id)) ?? undefined;
      if (!imagem) throw naoEncontrada;
      if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(id, imagem);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', imagem.tipo);
    res.setHeader('Cache-Control', 'public, max-age=21600');
    res.send(imagem.bytes);
  }

  private async baixar(url: string): Promise<Imagem | null> {
    try {
      const resposta = await this.fetch(url, { signal: AbortSignal.timeout(10_000) });
      const tipo = resposta.headers.get('content-type') ?? '';
      if (!resposta.ok || !tipo.startsWith('image/')) return null;
      const bytes = Buffer.from(await resposta.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
      return { tipo, bytes, ate: Date.now() + CACHE_MS };
    } catch {
      return null;
    }
  }

  /** Baixa a miniatura guardada; se a URL do Meta expirou, pede uma nova ao Graph e tenta de novo. */
  private async buscar(id: string): Promise<Imagem | null> {
    const anuncio = await this.prisma.anuncio.findUnique({ where: { id } });
    if (!anuncio?.miniaturaUrl) return null;
    const imagem = await this.baixar(anuncio.miniaturaUrl);
    if (imagem || !anuncio.criativoIdMeta) return imagem;

    try {
      const token = await this.conexao.token(anuncio.contaId);
      if (!token) return null;
      const criativo = await this.graph.get<{ image_url?: string; thumbnail_url?: string }>(
        token,
        anuncio.criativoIdMeta,
        { fields: 'image_url,thumbnail_url', thumbnail_width: 320, thumbnail_height: 320 },
        { contaId: anuncio.contaId, operacao: 'miniatura' },
      );
      const nova = criativo.image_url || criativo.thumbnail_url;
      if (!nova) return null;
      await this.prisma.anuncio.update({ where: { id }, data: { miniaturaUrl: nova } });
      return this.baixar(nova);
    } catch {
      return null;
    }
  }
}
