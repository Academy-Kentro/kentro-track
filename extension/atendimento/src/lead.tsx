import { useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso } from '../../comum/componentes';
import { dinheiro, haQuanto } from '../../comum/formato';
import { Icone, NomeIcone } from '../../comum/icones';
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

const ICONE_ORIGEM: Record<LeadPainel['origem'], NomeIcone> = { ctwa: 'megafone', formulario: 'formulario', link: 'link', organico: 'mensagem' };

/**
 * Campanha, conjunto e anúncio com rótulo. Muitos clientes dão o mesmo nome aos três: níveis
 * seguidos com o mesmo nome viram uma linha só ("Campanha, conjunto e anúncio").
 */
export function niveis(lista: [string, string | null | undefined][]): { rotulo: string; nome: string }[] {
  const grupos: { rotulos: string[]; nome: string }[] = [];
  for (const [rotulo, nome] of lista) {
    if (!nome) continue;
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.nome.trim() === nome.trim()) ultimo.rotulos.push(rotulo);
    else grupos.push({ rotulos: [rotulo], nome });
  }
  return grupos.map((g) => {
    const [primeiro, ...resto] = g.rotulos;
    const demais = resto.map((r) => r.toLowerCase());
    const juntos = demais.length === 0 ? primeiro : `${[primeiro, ...demais.slice(0, -1)].join(', ')} e ${demais.at(-1)}`;
    return { rotulo: juntos, nome: g.nome };
  });
}

function Miniatura({ url }: { url: string | null }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) return null;
  return <img class="kt-anuncio-imagem" src={url} alt="" loading="lazy" onError={() => setFalhou(true)} />;
}

export function Origem({ lead }: { lead: LeadPainel }) {
  const a = lead.anuncio;
  const titulo = a?.anuncio?.titulo ?? a?.titulo;
  const texto = a?.anuncio?.texto ?? a?.texto;
  const aproximado = a?.vinculo === 'url' || a?.vinculo === 'texto';
  return (
    <section class="kt-card kt-origem">
      <div class="kt-origem-topo">
        <span class={`kt-selo${lead.origem === 'organico' ? ' kt-selo-neutro' : ''}`}>
          <Icone nome={ICONE_ORIGEM[lead.origem]} tamanho={12} />
          {ORIGEM[lead.origem]}
        </span>
        <span class="kt-origem-quando">
          <Icone nome="relogio" tamanho={12} />
          chegou {haQuanto(lead.recebidoEm)}
        </span>
      </div>
      {a && (
        <div class="kt-anuncio">
          <Miniatura url={a.anuncio?.miniatura ?? null} />
          {titulo && <h3>{titulo}</h3>}
          {texto && <p class="kt-anuncio-texto">{texto}</p>}
          {a.campanha?.nome ? (
            <div class="kt-trilha">
              <Icone nome="megafone" tamanho={12} />
              <dl>
                {niveis([
                  ['Campanha', a.campanha.nome],
                  ['Conjunto', a.conjunto?.nome],
                  ['Anúncio', a.anuncio?.nome],
                ]).map((n) => (
                  <div key={n.rotulo}>
                    <dt>{n.rotulo}:</dt> <dd>{n.nome}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p class="kt-muted kt-trilha">
              <Icone nome="info" tamanho={12} />
              <span>Campanha ainda não identificada. Os números do Meta podem não ter sido sincronizados ainda.</span>
            </p>
          )}
          {aproximado && (
            <p class="kt-aproximado">
              <Icone nome="alerta" tamanho={12} />
              <span>Anúncio identificado pelo {a.vinculo === 'url' ? 'link do post' : 'texto'}: confira se faz sentido.</span>
            </p>
          )}
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

/** Qualificado / Venda / Descartado: alimenta o funil do gestor e o evento no pixel. */
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
    <section class="kt-card kt-etapas">
      <div class="kt-etapa-atual">
        <span class="kt-muted">Etapa:</span> <span class={`kt-etapa kt-etapa-${lead.etapa}`}>{ETAPA[lead.etapa]}</span>
        {lead.etapa === 'venda' && lead.valorVenda != null && <strong> · {dinheiro(lead.valorVenda)}</strong>}
        {lead.etapa === 'descartado' && lead.motivoDescarte && <span class="kt-muted"> · {lead.motivoDescarte}</span>}
        {(lead.etapa === 'venda' || lead.etapa === 'descartado') && (
          <button type="button" class="kt-link kt-reabrir" disabled={enviando} onClick={() => enviar('em_atendimento')}>
            <Icone nome="desfazer" tamanho={12} />
            Reabrir
          </button>
        )}
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-botoes-etapa">
        <button type="button" class="kt-botao kt-botao-secundario" disabled={enviando || lead.etapa === 'qualificado'} onClick={() => enviar('qualificado')}>
          <Icone nome="estrela" tamanho={14} />
          Qualificado
        </button>
        <button type="button" class="kt-botao kt-botao-sucesso" aria-expanded={aberto === 'venda'} disabled={enviando} onClick={() => setAberto(aberto === 'venda' ? null : 'venda')}>
          <Icone nome="sacola" tamanho={14} />
          Venda
        </button>
        <button type="button" class="kt-botao kt-botao-perigo" aria-expanded={aberto === 'descartado'} disabled={enviando} onClick={() => setAberto(aberto === 'descartado' ? null : 'descartado')}>
          <Icone nome="fechar" tamanho={14} />
          Descartar
        </button>
      </div>
      {aberto === 'venda' && (
        <div class="kt-formulario-etapa">
          <label class="kt-campo">
            <span>Valor da venda (R$)</span>
            <input inputMode="decimal" value={valor} placeholder="0,00" onInput={(e) => setValor((e.target as HTMLInputElement).value)} />
          </label>
          <button type="button" class="kt-botao kt-botao-sucesso" disabled={enviando || !valor.trim() || !Number.isFinite(valorNumero) || valorNumero < 0} onClick={() => enviar('venda', { valor: Math.round(valorNumero * 100) / 100 })}>
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
      {(lead.eventosMeta ?? []).length > 0 && (
        <p class="kt-eventos-meta">
          <Icone nome="raio" tamanho={12} />
          <span>
            Meta:{' '}
            {lead.eventosMeta!.map((e, i) => (
              <span key={e.gatilho} class={`kt-evento-meta kt-evento-meta-${e.status}`}>
                {i > 0 && ' · '}
                {e.evento} {e.status === 'enviado' ? '✓' : e.status === 'pendente' ? '(na fila)' : '(erro)'}
              </span>
            ))}
          </span>
        </p>
      )}
    </section>
  );
}

export function Entradas({ lead }: { lead: LeadPainel }) {
  if (lead.outrasEntradas.length === 0) return null;
  return (
    <section class="kt-card">
      <h3 class="kt-titulo-pequeno">
        <Icone nome="historico" tamanho={14} />
        Outras vezes que este contato chegou
      </h3>
      <ul class="kt-entradas">
        {lead.outrasEntradas.map((o) => (
          <li key={o.id}>
            <span class="kt-entrada-data">{new Date(o.recebidoEm).toLocaleDateString('pt-BR')}</span>
            <span class="kt-entrada-texto">{o.campanha ?? ORIGEM[o.origem as LeadPainel['origem']] ?? o.origem}</span>
            <span class={`kt-etapa kt-etapa-${o.etapa}`}>{ETAPA[o.etapa]}</span>
            {o.valorVenda != null && <strong> · {dinheiro(o.valorVenda)}</strong>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Historico({ lead }: { lead: LeadPainel }) {
  if (lead.historico.length === 0) return null;
  return (
    <details class="kt-sanfona kt-historico">
      <summary>Histórico</summary>
      <ul class="kt-linha-tempo">
        {lead.historico.map((h, i) => (
          <li key={i}>
            <span class="kt-muted">{new Date(h.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span>{h.texto}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
