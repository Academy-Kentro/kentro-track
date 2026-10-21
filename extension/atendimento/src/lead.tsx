import { useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso } from '../../comum/componentes';
import { dinheiro, haQuanto } from '../../comum/formato';
import { avisar } from '../../comum/omni';

export type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'venda' | 'descartado';

export interface LeadPainel {
  id: string;
  origem: 'ctwa' | 'formulario' | 'link' | 'organico';
  etapa: Etapa;
  nome: string | null;
  recebidoEm: string;
  valorVenda: number | null;
  motivoDescarte: string | null;
  respostas: { pergunta: string; resposta: string }[];
  anuncio: {
    vinculo: 'id' | 'url' | 'texto' | null;
    campanha: { idMeta: string; nome: string | null } | null;
    conjunto: { idMeta: string; nome: string } | null;
    anuncio: { idMeta: string; nome: string; titulo: string | null; texto: string | null; miniatura: string | null } | null;
    titulo: string | null;
    texto: string | null;
    url: string | null;
  } | null;
  historico: { tipo: string; texto: string; autor: string; em: string }[];
  /** O que já foi (ou está indo) para o pixel deste lead. */
  eventosMeta?: { gatilho: string; evento: string; status: 'pendente' | 'enviado' | 'erro' | 'descartado' }[];
  outrasEntradas: { id: string; origem: string; etapa: Etapa; recebidoEm: string; campanha: string | null; valorVenda: number | null }[];
}

const ORIGEM: Record<LeadPainel['origem'], string> = {
  ctwa: 'Veio de um anúncio',
  formulario: 'Formulário de anúncio',
  link: 'Link rastreável',
  organico: 'Sem anúncio identificado',
};

export const ETAPA: Record<Etapa, string> = {
  novo: 'Novo',
  em_atendimento: 'Em atendimento',
  qualificado: 'Qualificado',
  venda: 'Venda',
  descartado: 'Descartado',
};

const MOTIVOS = ['Sem interesse', 'Sem orçamento', 'Não respondeu', 'Fora do perfil', 'Comprou com concorrente', 'Só pesquisando preço', 'Outro'];

function Miniatura({ url }: { url: string | null }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) return null;
  return <img class="kt-anuncio-imagem" src={url} alt="" loading="lazy" onError={() => setFalhou(true)} />;
}

export function Origem({ lead }: { lead: LeadPainel }) {
  const a = lead.anuncio;
  const titulo = a?.anuncio?.titulo ?? a?.titulo;
  const texto = a?.anuncio?.texto ?? a?.texto;
  return (
    <section class="kt-card kt-origem">
      <p class="kt-origem-topo">
        <span class={`kt-selo${lead.origem === 'organico' ? ' kt-selo-neutro' : ''}`}>{ORIGEM[lead.origem]}</span>
        <span class="kt-muted"> · chegou {haQuanto(lead.recebidoEm)}</span>
      </p>
      {a && (
        <div class="kt-anuncio">
          <Miniatura url={a.anuncio?.miniatura ?? null} />
          <div>
            {a.campanha?.nome && (
              <p class="kt-trilha">
                {a.campanha.nome}
                {a.conjunto && ` › ${a.conjunto.nome}`}
                {a.anuncio && ` › ${a.anuncio.nome}`}
              </p>
            )}
            {titulo && <h3>{titulo}</h3>}
            {texto && <p class="kt-anuncio-texto">{texto}</p>}
            {!a.campanha && <p class="kt-muted">Campanha ainda não identificada. Os números do Meta podem não ter sido sincronizados ainda.</p>}
            {(a.vinculo === 'url' || a.vinculo === 'texto') && (
              <p class="kt-muted">Anúncio identificado pelo {a.vinculo === 'url' ? 'link do post' : 'texto'}: confira se faz sentido.</p>
            )}
          </div>
        </div>
      )}
      {lead.respostas.length > 0 && (
        <dl class="kt-respostas">
          {lead.respostas.map((r, i) => (
            <div key={i}>
              <dt>{r.pergunta}</dt>
              <dd>{r.resposta}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Qualificado / Venda / Descartado: alimenta o funil do gestor (e, na Fase 3, o evento no pixel). */
export function Etapas({ api, lead, mudar }: { api: Api; lead: LeadPainel; mudar: (l: LeadPainel) => void }) {
  const [aberto, setAberto] = useState<'venda' | 'descartado' | null>(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const enviar = async (etapa: Etapa, extra: { valor?: number; motivo?: string } = {}) => {
    setEnviando(true);
    setErro('');
    try {
      mudar(await api<LeadPainel>(`/v1/atendimento/leads/${lead.id}/etapa`, { method: 'POST', body: { etapa, ...extra } }));
      setAberto(null);
      avisar(`Lead marcado como ${ETAPA[etapa].toLowerCase()}.`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };
  const valorNumero = Number(valor.replace(/\./g, '').replace(',', '.'));

  return (
    <section class="kt-card">
      <p>
        Etapa: <strong>{ETAPA[lead.etapa]}</strong>
        {lead.etapa === 'venda' && lead.valorVenda != null && ` · ${dinheiro(lead.valorVenda)}`}
        {lead.etapa === 'descartado' && lead.motivoDescarte && ` · ${lead.motivoDescarte}`}
      </p>
      {(lead.eventosMeta ?? []).length > 0 && (
        <p class="kt-muted kt-eventos-meta">
          Meta:{' '}
          {lead.eventosMeta!.map((e, i) => (
            <span key={e.gatilho}>
              {i > 0 && ' · '}
              {e.evento} {e.status === 'enviado' ? '✓' : e.status === 'pendente' ? '(na fila)' : '(erro)'}
            </span>
          ))}
        </p>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao kt-botao-suave" disabled={enviando || lead.etapa === 'qualificado'} onClick={() => enviar('qualificado')}>
          Qualificado
        </button>
        <button type="button" class="kt-botao" disabled={enviando} onClick={() => setAberto(aberto === 'venda' ? null : 'venda')}>
          Venda
        </button>
        <button type="button" class="kt-botao kt-botao-perigo" disabled={enviando} onClick={() => setAberto(aberto === 'descartado' ? null : 'descartado')}>
          Descartar
        </button>
        {(lead.etapa === 'venda' || lead.etapa === 'descartado') && (
          <button type="button" class="kt-link" disabled={enviando} onClick={() => enviar('em_atendimento')}>
            Reabrir
          </button>
        )}
      </div>
      {aberto === 'venda' && (
        <div class="kt-formulario-etapa">
          <label class="kt-campo">
            <span>Valor da venda (R$)</span>
            <input inputMode="decimal" value={valor} placeholder="0,00" onInput={(e) => setValor((e.target as HTMLInputElement).value)} />
          </label>
          <button type="button" class="kt-botao" disabled={enviando || !valor.trim() || !Number.isFinite(valorNumero) || valorNumero < 0} onClick={() => enviar('venda', { valor: Math.round(valorNumero * 100) / 100 })}>
            Registrar venda
          </button>
        </div>
      )}
      {aberto === 'descartado' && (
        <div class="kt-formulario-etapa">
          <label class="kt-campo">
            <span>Motivo</span>
            <select value={motivo} onChange={(e) => setMotivo((e.target as HTMLSelectElement).value)}>
              {MOTIVOS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button type="button" class="kt-botao kt-botao-perigo" disabled={enviando} onClick={() => enviar('descartado', { motivo })}>
            Descartar lead
          </button>
        </div>
      )}
    </section>
  );
}

export function Entradas({ lead }: { lead: LeadPainel }) {
  if (lead.outrasEntradas.length === 0) return null;
  return (
    <section class="kt-card">
      <h3>Outras vezes que este contato chegou</h3>
      <ul class="kt-entradas">
        {lead.outrasEntradas.map((o) => (
          <li key={o.id}>
            <span>{new Date(o.recebidoEm).toLocaleDateString('pt-BR')}</span>
            <span class="kt-muted"> {o.campanha ?? ORIGEM[o.origem as LeadPainel['origem']] ?? o.origem}</span>
            <span> · {ETAPA[o.etapa]}</span>
            {o.valorVenda != null && <span> · {dinheiro(o.valorVenda)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Historico({ lead }: { lead: LeadPainel }) {
  if (lead.historico.length === 0) return null;
  return (
    <details class="kt-historico">
      <summary class="kt-muted">Histórico</summary>
      <ul>
        {lead.historico.map((h, i) => (
          <li key={i}>
            <span class="kt-muted">{new Date(h.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> {h.texto}
          </li>
        ))}
      </ul>
    </details>
  );
}
