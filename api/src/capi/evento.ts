import { createHash } from 'node:crypto';
import type { Lead } from '@prisma/client';

export const GATILHOS = ['lead_recebido', 'qualificado', 'venda', 'descartado'] as const;
export type Gatilho = (typeof GATILHOS)[number];
export type Mapeamento = Record<Gatilho, string | null>;

/** Padrão: o que o n8n já mandava (Lead) mais as etapas do funil; descarte não vai. */
export const MAPEAMENTO_PADRAO: Mapeamento = { lead_recebido: 'Lead', qualificado: 'QualifiedLead', venda: 'Purchase', descartado: null };

export function lerMapeamento(bruto: unknown): Mapeamento {
  const m = { ...MAPEAMENTO_PADRAO };
  if (bruto && typeof bruto === 'object') {
    for (const g of GATILHOS) {
      const v = (bruto as Record<string, unknown>)[g];
      if (v === null) m[g] = null;
      else if (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(v)) m[g] = v;
    }
  }
  return m;
}

/** SHA-256 em hexadecimal, como o Meta pede para os dados do cliente (normalizados antes). */
export function hash(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

/** Nome sem acento, minúsculo, só letras: o formato que o Meta compara. */
function normalizarNome(parte: string): string {
  return parte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export interface Contexto {
  moeda: string;
  wabaId: string | null;
  /** Quando o gatilho aconteceu (event_time). */
  quando: Date;
}

/**
 * Monta o evento da API de Conversões pela origem do lead (seção 9.2 da spec):
 * - formulário (lead_id do Meta): integração de leads de CRM, action_source "system_generated";
 * - clique para WhatsApp com ctwa_clid e a conta do WhatsApp Business: "business_messaging";
 * - o resto: "chat", com o telefone em hash para o Meta casar com a pessoa.
 */
export function montarEvento(lead: Lead, gatilho: Gatilho, eventName: string, ctx: Contexto) {
  const eventId = `kt-${lead.id}-${gatilho}`;
  const userData: Record<string, unknown> = { external_id: [hash(lead.id)] };
  if (lead.telefone) {
    userData.ph = [hash(lead.telefone.replace(/\D/g, ''))];
    if (lead.telefone.startsWith('55')) userData.country = [hash('br')];
  }
  if (lead.email) userData.em = [hash(lead.email.trim().toLowerCase())];
  const partes = (lead.nome ?? '').trim().split(/\s+/).map(normalizarNome).filter(Boolean);
  if (partes.length) userData.fn = [hash(partes[0])];
  if (partes.length > 1) userData.ln = [hash(partes[partes.length - 1])];

  const customData: Record<string, unknown> = {};
  if (gatilho === 'venda' && lead.valorVenda != null) {
    customData.value = Number(lead.valorVenda);
    customData.currency = ctx.moeda;
  }

  const evento: Record<string, unknown> = { event_name: eventName, event_time: Math.floor(ctx.quando.getTime() / 1000), event_id: eventId };
  if (lead.origem === 'formulario' && lead.leadgenId) {
    evento.action_source = 'system_generated';
    userData.lead_id = lead.leadgenId;
    Object.assign(customData, { event_source: 'crm', lead_event_source: 'Kentro Track' });
  } else if (lead.ctwaClid && ctx.wabaId) {
    evento.action_source = 'business_messaging';
    evento.messaging_channel = 'whatsapp';
    Object.assign(userData, { ctwa_clid: lead.ctwaClid, whatsapp_business_account_id: ctx.wabaId });
  } else {
    evento.action_source = 'chat';
  }
  evento.user_data = userData;
  if (Object.keys(customData).length) evento.custom_data = customData;
  return { eventId, payload: evento };
}
