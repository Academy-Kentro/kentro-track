import { Inject, Injectable } from '@nestjs/common';
import { LinkRastreavel } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { normalizarTelefone } from '../leads/telefone';
import { mensagemComCodigo, novoCodigoLink, novoCodigoVisita } from './codigo';

export interface DadosLink {
  nome: string;
  telefone: string;
  mensagem: string;
  computadorWeb?: boolean;
  tituloEspera?: string;
  mensagemEspera?: string;
  codigoVisivel?: boolean;
  ativo?: boolean;
}

/** Parâmetros da URL que viram dados da visita (o resto é ignorado). */
const PARAMETROS = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_content: 'utmContent',
  utm_term: 'utmTerm',
  gclid: 'gclid',
  gbraid: 'gbraid',
  wbraid: 'wbraid',
  fbclid: 'fbclid',
  fbid: 'anuncioIdMeta',
} as const;

const MAX_PARAMETRO = 300;
const ESPERA_SEGUNDOS = 5;
/** Quem só lê a página para montar prévia não é visita, e não precisa de código. */
const ROBO = /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|slack|preview|meta-externalagent/i;
const MOVEL = /android|iphone|ipad|ipod|mobile/i;

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  private url(link: Pick<LinkRastreavel, 'codigo'>) {
    return `${this.config.urlPublica}/l/${link.codigo}`;
  }

  private publico(link: LinkRastreavel) {
    return {
      id: link.id,
      nome: link.nome,
      telefone: link.telefone,
      mensagem: link.mensagem,
      computadorWeb: link.computadorWeb,
      tituloEspera: link.tituloEspera,
      mensagemEspera: link.mensagemEspera,
      codigoVisivel: link.codigoVisivel,
      ativo: link.ativo,
      /** Para anúncio do Meta: mostra a página de espera antes de abrir o WhatsApp. */
      url: this.url(link),
      /** Para site: abre o WhatsApp direto. */
      urlDireta: `${this.url(link)}?direto=1`,
    };
  }

  /** Os links da conta com visitas, conversas, vendas e receita (de sempre). */
  async listar(contaId: string) {
    const [links, visitas, leads] = await Promise.all([
      this.prisma.linkRastreavel.findMany({ where: { contaId }, orderBy: { criadoEm: 'desc' } }),
      this.prisma.visitaLink.groupBy({ by: ['linkId'], where: { contaId }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ link_id: string; conversas: bigint; vendas: bigint; receita: unknown }[]>`
        SELECT link_id::text AS link_id, COUNT(*) AS conversas, COUNT(*) FILTER (WHERE etapa = 'venda') AS vendas,
               COALESCE(SUM(valor_venda) FILTER (WHERE etapa = 'venda'), 0) AS receita
        FROM leads WHERE conta_id = ${contaId}::uuid AND link_id IS NOT NULL GROUP BY 1`,
    ]);
    const nVisitas = new Map(visitas.map((v) => [v.linkId, v._count._all]));
    const nLeads = new Map(leads.map((l) => [l.link_id, l]));
    return {
      pixel: this.pixel(contaId),
      /** Parâmetros para colar no anúncio do Meta (o Meta preenche as chaves duplas). */
      parametrosMeta: 'utm_source=meta&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&fbid={{ad.id}}',
      itens: links.map((l) => ({
        ...this.publico(l),
        visitas: nVisitas.get(l.id) ?? 0,
        conversas: Number(nLeads.get(l.id)?.conversas ?? 0),
        vendas: Number(nLeads.get(l.id)?.vendas ?? 0),
        receita: Number(nLeads.get(l.id)?.receita ?? 0),
      })),
    };
  }

  private pixel(contaId: string): string {
    return `<script async src="${this.config.urlPublica}/p/${contaId}.js"></script>`;
  }

  private dados(d: DadosLink) {
    const fone = normalizarTelefone(d.telefone);
    if (!fone) throw new ErroApi(400, 'TELEFONE_INVALIDO', 'Informe o WhatsApp com DDD. Ex.: 5538999990000.');
    return {
      nome: d.nome.trim().slice(0, 80),
      telefone: fone.telefone,
      mensagem: d.mensagem.trim().slice(0, 500),
      computadorWeb: d.computadorWeb ?? true,
      tituloEspera: d.tituloEspera?.trim().slice(0, 80) || 'Por favor, aguarde alguns segundos.',
      mensagemEspera: d.mensagemEspera?.trim().slice(0, 200) || 'Estamos localizando um atendente disponível…',
      codigoVisivel: d.codigoVisivel ?? false,
      ativo: d.ativo ?? true,
    };
  }

  async criar(contaId: string, d: DadosLink) {
    return this.publico(await this.prisma.linkRastreavel.create({ data: { ...this.dados(d), contaId, codigo: novoCodigoLink() } }));
  }

  async atualizar(contaId: string, id: string, d: DadosLink) {
    const r = await this.prisma.linkRastreavel.updateMany({ where: { id, contaId }, data: this.dados(d) });
    if (r.count === 0) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Link não encontrado.');
    return this.publico(await this.prisma.linkRastreavel.findUniqueOrThrow({ where: { id } }));
  }

  /**
   * Quem clicou: grava a visita e devolve a página que leva ao WhatsApp. O destino sai só do que está
   * gravado no link, nunca da URL: não dá para usar este endereço para redirecionar a outro site.
   */
  async visitar(codigo: string, parametros: Record<string, unknown>, navegador: string): Promise<{ status: number; html: string }> {
    const link = await this.prisma.linkRastreavel.findUnique({ where: { codigo } });
    if (!link?.ativo) return { status: 404, html: pagina('Link indisponível', '<h1>Este link não está mais disponível.</h1>') };

    let mensagem = link.mensagem;
    if (!ROBO.test(navegador)) {
      const dados: Record<string, string> = {};
      for (const [nome, campo] of Object.entries(PARAMETROS)) {
        const valor = parametros[nome];
        if (typeof valor === 'string' && valor.trim()) dados[campo] = valor.trim().slice(0, MAX_PARAMETRO);
      }
      const { codigo: visita } = await this.prisma.visitaLink.create({ data: { ...dados, codigo: novoCodigoVisita(), contaId: link.contaId, linkId: link.id } });
      mensagem = mensagemComCodigo(mensagem, visita, link.codigoVisivel);
    }

    const texto = encodeURIComponent(mensagem);
    const destino =
      link.computadorWeb && !MOVEL.test(navegador)
        ? `https://web.whatsapp.com/send?phone=${link.telefone}&text=${texto}`
        : `https://wa.me/${link.telefone}?text=${texto}`;
    const espera = parametros.direto === '1' ? 0 : ESPERA_SEGUNDOS;
    const corpo = espera
      ? `<h1>${escapar(link.tituloEspera)}</h1><p>${escapar(link.mensagemEspera)}</p><p><a href="${escapar(destino)}">Abrir o WhatsApp agora</a></p>`
      : `<p><a href="${escapar(destino)}">Abrir o WhatsApp</a></p>`;
    return { status: 200, html: pagina(link.nome, corpo, `<meta http-equiv="refresh" content="${espera};url=${escapar(destino)}">`) };
  }

  /** O script do site: guarda de onde o visitante veio e leva esses parâmetros para os links rastreáveis. */
  scriptDoPixel(): string {
    const origem = JSON.stringify(`${this.config.urlPublica}/l/`);
    const nomes = JSON.stringify(Object.keys(PARAMETROS));
    return `(function(){var B=${origem},N=${nomes},K='kentro_track',D=90*864e5,s={};
try{var g=JSON.parse(localStorage.getItem(K)||'null');if(g&&g.ate>Date.now())s=g.p||{};}catch(e){}
var q=new URLSearchParams(location.search),m=false;N.forEach(function(n){var v=q.get(n);if(v){s[n]=v;m=true;}});
if(m){try{localStorage.setItem(K,JSON.stringify({ate:Date.now()+D,p:s}));}catch(e){}}
function u(a){if(!a||!a.href||a.href.indexOf(B)!==0)return;var l=new URL(a.href);Object.keys(s).forEach(function(n){if(!l.searchParams.has(n))l.searchParams.set(n,s[n]);});a.href=l.toString();}
function t(){[].forEach.call(document.querySelectorAll('a[href^="'+B+'"]'),u);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',t);else t();
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');u(a);},true);})();`;
  }
}

function pagina(titulo: string, corpo: string, cabeca = ''): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapar(titulo)}</title>${cabeca}<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:16px;text-align:center;color:#1f1f29}h1{font-size:1.3em;margin:0 0 8px}a{color:#128c4b}</style></head><body>${corpo}</body></html>`;
}
