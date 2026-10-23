import { Prisma } from '@prisma/client';

// Linha de /insights (level=ad, time_increment=1). O Meta manda números como texto.
export interface LinhaInsight {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

export const CAMPOS_INSIGHTS = [
  'ad_id',
  'adset_id',
  'campaign_id',
  'spend',
  'impressions',
  'clicks',
  'inline_link_clicks',
  'actions',
  'action_values',
].join(',');

/**
 * Tipos de ação que viram as colunas usadas no CPL (⚠ conferir com dados reais na Fase 1).
 * "lead" sozinho soma todas as origens, por isso não entra: contaria o formulário e o pixel duas vezes.
 */
const ACOES_FORMULARIO = ['onsite_conversion.lead_grouped', 'leadgen_grouped'];
const ACOES_SITE = ['offsite_conversion.fb_pixel_lead'];
const ACOES_CONVERSA = ['onsite_conversion.messaging_conversation_started_7d'];

const inteiro = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function porTipo(lista: { action_type: string; value: string }[] | undefined): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const a of lista ?? []) {
    const n = Number(a.value);
    if (a.action_type && Number.isFinite(n)) mapa[a.action_type] = (mapa[a.action_type] ?? 0) + n;
  }
  return mapa;
}

/** O primeiro tipo presente da lista (são sinônimos entre versões da API, não parcelas). */
function primeiro(acoes: Record<string, number>, tipos: string[]): number {
  for (const t of tipos) if (acoes[t] !== undefined) return inteiro(acoes[t]);
  return 0;
}

export function normalizarInsight(
  linha: LinhaInsight,
  ids: { contaId: string; contaAnuncioId: string },
): Prisma.InsightDiarioCreateManyInput {
  const acoes = porTipo(linha.actions);
  const gasto = Number(linha.spend ?? 0);
  return {
    contaId: ids.contaId,
    contaAnuncioId: ids.contaAnuncioId,
    data: new Date(`${linha.date_start}T00:00:00Z`),
    anuncioIdMeta: String(linha.ad_id),
    conjuntoIdMeta: String(linha.adset_id ?? ''),
    campanhaIdMeta: String(linha.campaign_id ?? ''),
    investimento: new Prisma.Decimal(Number.isFinite(gasto) ? gasto.toFixed(2) : '0'),
    impressoes: inteiro(linha.impressions),
    alcance: inteiro(linha.reach),
    cliques: inteiro(linha.clicks),
    cliquesLink: inteiro(linha.inline_link_clicks),
    leadsFormulario: primeiro(acoes, ACOES_FORMULARIO),
    leadsSite: primeiro(acoes, ACOES_SITE),
    conversas: primeiro(acoes, ACOES_CONVERSA),
    acoes,
    valoresAcoes: porTipo(linha.action_values),
  };
}
