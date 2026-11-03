import { useRef, useState } from 'preact/hooks';
import { mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, Carregando, Vazio } from '../../comum/componentes';
import { dinheiro, inteiro } from '../../comum/formato';
import { avisar } from '../../comum/omni';
import { useDados } from './filtro';
import { CLASSE_TIPO, consultaLeads, lerValor, ORIGENS, SITUACOES, type FiltroLeads, type LeadDaLista } from './leads-comum';
import type { EtapaFunil, TipoEtapa } from './tipos';

interface DadosQuadro {
  etapas: EtapaFunil[];
  cartoesPorColuna: number;
  porEtapa: Record<string, number>;
  itens: LeadDaLista[];
}

interface Coluna {
  id: string;
  rotulo: string;
  classe: string;
  tipo?: TipoEtapa;
}

const colunaDe = (l: LeadDaLista) => l.etapaId ?? l.etapa;

/** Venda pede o valor e perda pede o motivo, igual ao painel do atendente. */
function PedirDados({ lead, alvo, enviando, confirmar, cancelar }: { lead: LeadDaLista; alvo: Coluna; enviando: boolean; confirmar: (extra: { valor?: number; motivo?: string }) => void; cancelar: () => void }) {
  const [texto, setTexto] = useState('');
  const venda = alvo.tipo === 'venda';
  const valor = lerValor(texto);
  const valido = venda ? !!texto.trim() && Number.isFinite(valor) && valor >= 0 : !!texto.trim();
  return (
    <section class="kt-card kt-mover-lead">
      <p>
        Mover <strong>{lead.nome ?? 'Sem nome'}</strong> para <strong>{alvo.rotulo}</strong>
      </p>
      <label class="kt-campo">
        <span>{venda ? 'Valor da venda (R$)' : 'Motivo'}</span>
        <input inputMode={venda ? 'decimal' : 'text'} placeholder={venda ? '0,00' : ''} maxLength={venda ? 20 : 200} value={texto} onInput={(e) => setTexto((e.target as HTMLInputElement).value)} />
      </label>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={enviando || !valido} onClick={() => confirmar(venda ? { valor: Math.round(valor * 100) / 100 } : { motivo: texto.trim() })}>
          Confirmar
        </button>
        <button type="button" class="kt-botao kt-botao-fantasma" disabled={enviando} onClick={cancelar}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

export function QuadroLeads({ api, q, filtro }: { api: Api; q: string; filtro: FiltroLeads }) {
  const carga = useDados<DadosQuadro>(api, `/v1/painel/leads/quadro?${consultaLeads(q, { ...filtro, etapa: '', pagina: 1 })}`);
  const { dados, carregando } = carga;
  const [pendente, setPendente] = useState<{ lead: LeadDaLista; alvo: Coluna } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const arrastado = useRef<LeadDaLista | null>(null);

  if (!dados) return carga.erro ? <Aviso tipo="erro">{carga.erro}</Aviso> : <Carregando />;

  const colunas: Coluna[] = [
    ...SITUACOES,
    ...dados.etapas.filter((e) => e.ativa && e.noPainel).map((e) => ({ id: e.id, rotulo: e.nome, classe: CLASSE_TIPO[e.tipo], tipo: e.tipo })),
  ];
  const destinos = colunas.filter((c) => c.id !== 'novo');
  const naTela = new Set(colunas.map((c) => c.id));
  const foraDoQuadro = Object.entries(dados.porEtapa).reduce((soma, [id, n]) => (naTela.has(id) ? soma : soma + n), 0);

  const enviar = async (lead: LeadDaLista, alvo: Coluna, extra: { valor?: number; motivo?: string } = {}) => {
    setEnviando(true);
    setErro('');
    try {
      await api(`/v1/painel/leads/${lead.id}/etapa`, { method: 'POST', body: { etapa: alvo.id, ...extra } });
      setPendente(null);
      avisar(`${lead.nome ?? 'Lead'} movido para ${alvo.rotulo}.`);
      carga.recarregar?.();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };
  const mover = (lead: LeadDaLista, idAlvo: string) => {
    const alvo = destinos.find((c) => c.id === idAlvo);
    if (!alvo || colunaDe(lead) === idAlvo || enviando) return;
    if (alvo.tipo === 'venda' || alvo.tipo === 'perda') setPendente({ lead, alvo });
    else enviar(lead, alvo);
  };

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {(erro || carga.erro) && <Aviso tipo="erro">{erro || carga.erro}</Aviso>}
      {pendente && <PedirDados key={pendente.lead.id} lead={pendente.lead} alvo={pendente.alvo} enviando={enviando} confirmar={(extra) => enviar(pendente.lead, pendente.alvo, extra)} cancelar={() => setPendente(null)} />}
      {dados.itens.length === 0 ? (
        <section class="kt-card">
          <Vazio icone="lista" titulo="Nenhum lead com esses filtros no período" />
        </section>
      ) : (
        <div class="kt-quadro">
          {colunas.map((c) => {
            const cartoes = dados.itens.filter((l) => colunaDe(l) === c.id);
            const total = dados.porEtapa[c.id] ?? 0;
            return (
              <section
                key={c.id}
                class="kt-coluna"
                aria-label={c.rotulo}
                onDragOver={(e) => c.id !== 'novo' && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (arrastado.current) mover(arrastado.current, c.id);
                  arrastado.current = null;
                }}
              >
                <header class="kt-coluna-topo">
                  <span class={`kt-etapa kt-etapa-${c.classe}`}>{c.rotulo}</span>
                  <span class="kt-muted">{inteiro(total)}</span>
                </header>
                {cartoes.map((l) => (
                  <article
                    key={l.id}
                    class="kt-cartao-lead"
                    draggable
                    onDragStart={(e) => {
                      arrastado.current = l;
                      e.dataTransfer?.setData('text/plain', l.id);
                    }}
                  >
                    <strong>{l.nome ?? 'Sem nome'}</strong>
                    {l.telefone && <span class="kt-muted">{l.telefone}</span>}
                    <span class="kt-cartao-origem">
                      {l.campanha ?? ORIGENS.find((o) => o.id === l.origem)?.rotulo ?? l.origem}
                      {l.anuncio && <span class="kt-muted"> › {l.anuncio}</span>}
                    </span>
                    <span class="kt-muted">
                      {new Date(l.recebidoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {l.atendente && ` · ${l.atendente}`}
                    </span>
                    {l.valorVenda != null && <span class="kt-cartao-valor">{dinheiro(l.valorVenda)}</span>}
                    <select class="kt-cartao-mover" aria-label={`Mover ${l.nome ?? 'lead'} para outra etapa`} value="" disabled={enviando} onChange={(e) => mover(l, (e.target as HTMLSelectElement).value)}>
                      <option value="">Mover para…</option>
                      {destinos
                        .filter((d) => d.id !== c.id)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.rotulo}
                          </option>
                        ))}
                    </select>
                  </article>
                ))}
                {total > cartoes.length && <p class="kt-muted kt-coluna-mais">Mostrando os {inteiro(cartoes.length)} mais recentes de {inteiro(total)}.</p>}
              </section>
            );
          })}
        </div>
      )}
      <p class="kt-muted">
        Arraste o cartão ou use "Mover para…". Se a etapa tiver evento configurado, a mudança envia esse evento ao Meta.
        {foraDoQuadro > 0 && ` ${inteiro(foraDoQuadro)} ${foraDoQuadro === 1 ? 'lead está' : 'leads estão'} em etapas que não aparecem no painel.`}
      </p>
    </div>
  );
}
