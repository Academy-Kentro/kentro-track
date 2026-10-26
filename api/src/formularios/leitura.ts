import type { LeadDeFormulario } from '../leads/leads.service';

/** Lead como o Graph devolve em /{form_id}/leads. */
export interface LeadGraph {
  id: string;
  created_time: string;
  field_data?: { name: string; values?: string[] }[];
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
}

/** Pergunta como o Graph devolve em /{page_id}/leadgen_forms (campo questions). */
export interface PerguntaGraph {
  key: string;
  label?: string;
  type?: string;
}

/** Os campos padrão do Meta vêm sem rótulo (o formulário mostra o texto traduzido). */
const ROTULOS_PADRAO: Record<string, string> = {
  full_name: 'Nome completo',
  first_name: 'Nome',
  last_name: 'Sobrenome',
  email: 'E-mail',
  phone_number: 'Telefone',
  city: 'Cidade',
  state: 'Estado',
  province: 'Estado',
  country: 'País',
  zip_code: 'CEP',
  post_code: 'CEP',
  street_address: 'Endereço',
  date_of_birth: 'Data de nascimento',
  gender: 'Gênero',
  job_title: 'Cargo',
  company_name: 'Empresa',
  work_email: 'E-mail profissional',
  work_phone_number: 'Telefone comercial',
  cpf: 'CPF',
};

/** Estes viram nome, telefone e e-mail do lead; o resto vira resposta. */
const CONTATO = new Set(['full_name', 'first_name', 'last_name', 'email', 'phone_number']);

/** { chave: rótulo } das perguntas do formulário, para guardar e reler sem chamar o Meta de novo. */
export function rotulosDasPerguntas(perguntas: PerguntaGraph[] | undefined): Record<string, string> {
  const rotulos: Record<string, string> = {};
  for (const p of perguntas ?? []) if (p.key) rotulos[p.key] = p.label?.trim() || ROTULOS_PADRAO[p.key] || rotuloDaChave(p.key);
  return rotulos;
}

function rotuloDaChave(chave: string): string {
  const texto = chave.replace(/[_-]+/g, ' ').trim();
  return texto ? texto[0].toUpperCase() + texto.slice(1) : chave;
}

export function lerLead(l: LeadGraph, formulario: { idMeta: string; nome: string; perguntas: Record<string, string> }): LeadDeFormulario {
  const valor = (chave: string) =>
    l.field_data
      ?.find((c) => c.name === chave)
      ?.values?.map((v) => String(v).trim())
      .filter(Boolean)
      .join(', ') || undefined;
  const nome = valor('full_name') ?? ([valor('first_name'), valor('last_name')].filter(Boolean).join(' ') || undefined);
  const respostas = (l.field_data ?? [])
    .filter((c) => !CONTATO.has(c.name))
    .map((c) => ({
      chave: c.name,
      pergunta: formulario.perguntas[c.name] ?? ROTULOS_PADRAO[c.name] ?? rotuloDaChave(c.name),
      resposta: (c.values ?? []).map((v) => String(v).trim()).filter(Boolean).join(', '),
    }))
    .filter((r) => r.resposta);
  return {
    leadgenId: l.id,
    formularioIdMeta: formulario.idMeta,
    formularioNome: formulario.nome,
    criadoEm: new Date(l.created_time),
    nome,
    telefone: valor('phone_number'),
    email: valor('email'),
    respostas,
    anuncioIdMeta: l.ad_id || undefined,
    conjuntoIdMeta: l.adset_id || undefined,
    campanhaIdMeta: l.campaign_id || undefined,
  };
}

/** O que a captura da Kentro recebe. Plano: cada campo vira a variável capture_<campo> na automação. */
export interface PayloadKentro {
  evento: 'lead_formulario' | 'teste';
  lead_id: string;
  leadgen_id: string;
  titulo: string;
  nome: string;
  telefone: string;
  email: string;
  formulario: string;
  formulario_id: string;
  pagina: string;
  campanha: string;
  conjunto: string;
  anuncio: string;
  recebido_em: string;
  /** "Pergunta: resposta", uma por linha: pronto para a descrição da oportunidade. */
  respostas_texto: string;
  [resposta: `resposta_${string}`]: string;
}

/** Chave de variável segura na automação: letras, números e "_". */
const chaveVariavel = (chave: string) =>
  chave
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

export function montarPayloadKentro(d: {
  evento?: PayloadKentro['evento'];
  leadId: string;
  leadgenId: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  formulario: string;
  formularioId: string;
  pagina: string;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  recebidoEm: Date;
  fuso: string;
  respostas: { chave?: string; pergunta: string; resposta: string }[];
}): PayloadKentro {
  const payload: PayloadKentro = {
    evento: d.evento ?? 'lead_formulario',
    lead_id: d.leadId,
    leadgen_id: d.leadgenId,
    titulo: `${d.nome || d.telefone || 'Lead'} — ${d.formulario}`,
    nome: d.nome ?? '',
    telefone: d.telefone ?? '',
    email: d.email ?? '',
    formulario: d.formulario,
    formulario_id: d.formularioId,
    pagina: d.pagina,
    campanha: d.campanha ?? '',
    conjunto: d.conjunto ?? '',
    anuncio: d.anuncio ?? '',
    recebido_em: d.recebidoEm.toLocaleString('pt-BR', { timeZone: d.fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    respostas_texto: d.respostas.map((r) => `${r.pergunta}: ${r.resposta}`).join('\n'),
  };
  for (const r of d.respostas) {
    const chave = chaveVariavel(r.chave ?? r.pergunta);
    if (chave) payload[`resposta_${chave}`] = r.resposta;
  }
  return payload;
}
