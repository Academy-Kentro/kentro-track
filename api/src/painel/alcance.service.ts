import { Injectable, Logger } from '@nestjs/common';
import { ClienteGraph } from '../meta/cliente/graph';
import { ErroMeta, LimiteMeta, TokenInvalido } from '../meta/cliente/erros';
import { ConexaoService } from '../meta/conexao/conexao.service';
import { Filtro, PainelService } from './painel.service';

type Nivel = 'campanha' | 'conjunto' | 'anuncio';
type Valores = Record<Nivel, Record<string, { alcance: number; frequencia: number }>>;

interface LinhaAlcance {
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  reach?: string;
  frequency?: string;
}

const NIVEIS: { nivel: Nivel; level: string; campo: 'campaign_id' | 'adset_id' | 'ad_id' }[] = [
  { nivel: 'campanha', level: 'campaign', campo: 'campaign_id' },
  { nivel: 'conjunto', level: 'adset', campo: 'adset_id' },
  { nivel: 'anuncio', level: 'ad', campo: 'ad_id' },
];
const VALIDADE_MS = 60 * 60_000;
const MAX_NO_CACHE = 500;
const TEMPO_LIMITE_MS = 30_000;
const MAX_PAGINAS = 10;

/**
 * Alcance e frequência do período, lidos do Meta na hora. O alcance de cada dia não se soma (a mesma
 * pessoa contaria várias vezes), então não dá para tirar dos insights diários. Cada leitura gasta cota
 * do Meta: a resposta completa fica guardada por uma hora, e a falha não atrapalha o resto da aba.
 */
@Injectable()
export class AlcanceService {
  private readonly logger = new Logger('Alcance');
  private readonly guardados = new Map<string, { ate: number; valores: Valores }>();

  constructor(
    private readonly painel: PainelService,
    private readonly graph: ClienteGraph,
    private readonly conexao: ConexaoService,
  ) {}

  async alcance(contaId: string, filtro: Filtro, agora = Date.now()) {
    const { contas } = await this.painel.escopo(contaId, filtro);
    const chave = [contaId, filtro.de, filtro.ate, filtro.contaAnuncio ?? '', filtro.campanha ?? ''].join('|');
    const guardado = this.guardados.get(chave);
    if (guardado && guardado.ate > agora) return { ...guardado.valores, indisponivel: false };

    const valores: Valores = { campanha: {}, conjunto: {}, anuncio: {} };
    const token = await this.conexao.token(contaId);
    if (!token) return { ...valores, indisponivel: true };

    let indisponivel = false;
    const params = {
      time_range: JSON.stringify({ since: filtro.de, until: filtro.ate }),
      limit: 250,
      ...(filtro.campanha ? { filtering: JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: filtro.campanha }]) } : {}),
    };
    for (const conta of contas) {
      // A sincronização já está esperando o Meta liberar esta conta: não gasta o que falta.
      if (conta.limitadaAte && conta.limitadaAte.getTime() > agora) {
        indisponivel = true;
        continue;
      }
      for (const { nivel, level, campo } of NIVEIS) {
        try {
          const linhas = await this.graph.listar<LinhaAlcance>(
            token,
            `${conta.idMeta}/insights`,
            { ...params, level, fields: `${campo},reach,frequency` },
            { contaId, operacao: 'alcance', tempoLimiteMs: TEMPO_LIMITE_MS },
            MAX_PAGINAS,
          );
          for (const l of linhas) {
            const id = l[campo];
            const alcance = Number(l.reach);
            const frequencia = Number(l.frequency);
            if (id && Number.isFinite(alcance) && Number.isFinite(frequencia)) valores[nivel][String(id)] = { alcance: Math.round(alcance), frequencia: Math.round(frequencia * 100) / 100 };
          }
        } catch (e) {
          if (!(e instanceof ErroMeta)) throw e;
          indisponivel = true;
          this.logger.warn(`Alcance ${level} da conta de anúncio ${conta.idMeta} (conta ${contaId}): ${e.codigo} ${e.message}`);
          // Sem cota ou sem token, os outros níveis falhariam igual.
          if (e instanceof LimiteMeta || e instanceof TokenInvalido) break;
        }
      }
    }
    if (!indisponivel) {
      if (this.guardados.size >= MAX_NO_CACHE) this.guardados.clear();
      this.guardados.set(chave, { ate: agora + VALIDADE_MS, valores });
    }
    return { ...valores, indisponivel };
  }
}
