import { useEffect, useState } from 'preact/hooks';
import { Avatar, Aviso, Carregando, Vazio } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { dinheiro, inteiro, percentual } from '../../comum/formato';
import { avisar, codigoDoErro, type ChatOmni, type Omni } from '../../comum/omni';
import { Seletor, type Carga } from './filtro';

export type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'venda' | 'descartado';

export interface DadosLeads {
  pagina: number;
  temMais: boolean;
  porEtapa: Partial<Record<Etapa, number>>;
  itens: {
    id: string;
    origem: 'ctwa' | 'formulario' | 'link' | 'organico';
    etapa: Etapa;
    nome: string | null;
    telefone: string | null;
    chatId: string | null;
    recebidoEm: string;
    atendente: string | null;
    valorVenda: number | null;
    campanha: string | null;
    anuncio: string | null;
    vinculoAproximado: boolean;
  }[];
}

export interface DadosEquipe {
  moeda: string;
  atendentes: {
    id: string | null;
    nome: string;
    entradas: number;
    qualificados: number;
    vendas: number;
    descartados: number;
    receita: number;
    taxaVenda: number | null;
    minutosAteAtender: number | null;
  }[];
}

export interface FiltroLeads {
  origem: '' | 'ctwa' | 'formulario' | 'link' | 'organico';
  etapa: '' | Etapa;
  pagina: number;
}

const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: 'novo', rotulo: 'Novos' },
  { id: 'em_atendimento', rotulo: 'Em atendimento' },
  { id: 'qualificado', rotulo: 'Qualificados' },
  { id: 'venda', rotulo: 'Vendas' },
  { id: 'descartado', rotulo: 'Descartados' },
];

const ORIGENS: { id: FiltroLeads['origem']; rotulo: string }[] = [
  { id: '', rotulo: 'Todas as origens' },
  { id: 'ctwa', rotulo: 'Anúncio (WhatsApp)' },
  { id: 'formulario', rotulo: 'Formulário' },
  { id: 'link', rotulo: 'Link rastreável' },
  { id: 'organico', rotulo: 'Sem anúncio' },
];

const ETAPA_ROTULO: Record<Etapa, string> = { novo: 'Novo', em_atendimento: 'Em atendimento', qualificado: 'Qualificado', venda: 'Venda', descartado: 'Descartado' };

/**
 * Quem está com o atendimento agora, lido da própria Kentro (chamadas do SDK, fora do limite do
 * omni.http.request). Só para os leads em que o Kentro Track ainda não sabe o atendente.
 */
function useAtendentesAtuais(omni: Omni, itens: DadosLeads['itens'] | undefined): Record<string, string> {
  const [nomes, setNomes] = useState<Record<string, string>>({});
  useEffect(() => {
    const semAtendente = (itens ?? []).filter((l) => l.chatId && !l.atendente);
    if (semAtendente.length === 0) return;
    let vivo = true;
    (async () => {
      const usuarios = await Promise.resolve()
        .then(() => omni.users.list())
        .catch(() => []);
      const porId = new Map(usuarios.map((u) => [u.id, u.name]));
      const achados: Record<string, string> = {};
      await Promise.all(
        semAtendente.map(async (l) => {
          const chat = await Promise.resolve()
            .then(() => omni.chats.get(Number(l.chatId)))
            .catch(() => null);
          const nome = chat?.userId ? porId.get(chat.userId) : undefined;
          if (nome) achados[l.chatId!] = nome;
        }),
      );
      if (vivo) setNomes(achados);
    })();
    return () => {
      vivo = false;
    };
  }, [omni, itens]);
  return nomes;
}

export function Leads({ omni, carga, filtro, mudar }: { omni: Omni; carga: Carga<DadosLeads>; filtro: FiltroLeads; mudar: (f: FiltroLeads) => void }) {
  const { dados, erro, carregando } = carga;
  const atuais = useAtendentesAtuais(omni, dados?.itens);

  // Consulta antes de abrir: o select só diz "não abriu", o get diz se o usuário enxerga o atendimento.
  const abrirConversa = async (chatId: string, atendente: string | null) => {
    const id = Number(chatId);
    let chat: ChatOmni;
    try {
      chat = await omni.chats.get(id);
    } catch (e) {
      const codigo = codigoDoErro(e);
      avisar(
        codigo === 'not_found' || codigo === 'forbidden'
          ? `Seu usuário não enxerga o atendimento #${id} na Kentro (encerrado, de outra fila ou sem permissão).`
          : `Não foi possível consultar o atendimento #${id} na Kentro (${codigo}).`,
        'error',
      );
      return;
    }
    const r: { selected: boolean; codigo?: string } = await omni.chats.select(id).catch((e) => ({ selected: false, codigo: codigoDoErro(e) }));
    if (r.selected) return;
    console.warn('[Kentro Track] a Kentro não abriu o atendimento', { chat, resposta: r });
    const com = atendente ?? atuais[chatId];
    avisar(`A Kentro não abriu o atendimento #${id}${com ? `, que está com ${com}` : ''}${r.codigo ? ` (${r.codigo})` : ''}.`, 'error');
  };

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      <div class="kt-barra-leads">
        {dados && (
          <div class="kt-chips" role="group" aria-label="Etapa">
            <button type="button" class="kt-chip" aria-pressed={filtro.etapa === ''} onClick={() => mudar({ ...filtro, etapa: '', pagina: 1 })}>
              Todas <span class="kt-chip-n">({inteiro(Object.values(dados.porEtapa).reduce((a, b) => a + (b ?? 0), 0))})</span>
            </button>
            {ETAPAS.map((e) => (
              <button key={e.id} type="button" class={`kt-chip kt-chip-${e.id}`} aria-pressed={filtro.etapa === e.id} onClick={() => mudar({ ...filtro, etapa: e.id, pagina: 1 })}>
                {e.rotulo} <span class="kt-chip-n">({inteiro(dados.porEtapa[e.id] ?? 0)})</span>
              </button>
            ))}
          </div>
        )}
        <Seletor icone="funil" rotulo="Origem" valor={filtro.origem} mudar={(v) => mudar({ ...filtro, origem: v as FiltroLeads['origem'], pagina: 1 })}>
          {ORIGENS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.rotulo}
            </option>
          ))}
        </Seletor>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <Carregando />
      ) : dados.itens.length === 0 ? (
        <section class="kt-card">
          <Vazio icone="lista" titulo="Nenhum lead com esses filtros no período" />
        </section>
      ) : (
        <>
          <div class="kt-tabela-rolagem kt-tabela-card">
            <table class="kt-tabela">
              <thead>
                <tr>
                  <th>Chegou</th>
                  <th>Lead</th>
                  <th>Origem</th>
                  <th>Atendente</th>
                  <th>Etapa</th>
                  <th class="kt-num">Venda</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.recebidoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      <span class="kt-pessoa">
                        <Avatar nome={l.nome} />
                        <span>
                          {l.nome ?? 'Sem nome'}
                          {l.telefone && <span class="kt-muted"> · {l.telefone}</span>}
                        </span>
                      </span>
                    </td>
                    <td class="kt-celula-quebra">
                      {l.campanha ?? ORIGENS.find((o) => o.id === l.origem)?.rotulo ?? l.origem}
                      {l.anuncio && <span class="kt-muted"> › {l.anuncio}</span>}
                      {l.vinculoAproximado && <span class="kt-muted" title="Anúncio identificado pelo texto ou pelo link do post"> *</span>}
                    </td>
                    <td>
                      {l.atendente ?? (l.chatId && atuais[l.chatId] ? <span title="Com o atendimento agora na Kentro">{atuais[l.chatId]}</span> : '—')}
                    </td>
                    <td>
                      <span class={`kt-etapa kt-etapa-${l.etapa}`}>{ETAPA_ROTULO[l.etapa]}</span>
                    </td>
                    <td class="kt-num">{l.valorVenda == null ? '—' : dinheiro(l.valorVenda)}</td>
                    <td>
                      {l.chatId && (
                        <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => abrirConversa(l.chatId!, l.atendente)}>
                          <Icone nome="externo" tamanho={13} />
                          Abrir conversa
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="kt-muted">* anúncio identificado pelo texto ou pelo link do post (aproximado). O telefone aparece parcial de propósito.</p>
          <div class="kt-paginacao">
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={dados.pagina <= 1} onClick={() => mudar({ ...filtro, pagina: dados.pagina - 1 })}>
              Anteriores
            </button>
            <span class="kt-muted">Página {dados.pagina}</span>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={!dados.temMais} onClick={() => mudar({ ...filtro, pagina: dados.pagina + 1 })}>
              Próximos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Equipe({ carga }: { carga: Carga<DadosEquipe> }) {
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  if (dados.atendentes.length === 0) {
    return (
      <section class="kt-card">
        <Vazio icone="usuarios" titulo="Nenhum lead no atendimento neste período" />
      </section>
    );
  }
  const melhorTaxa = Math.max(1, ...dados.atendentes.map((a) => a.taxaVenda ?? 0));
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-tabela-rolagem kt-tabela-card">
        <table class="kt-tabela">
          <thead>
            <tr>
              <th>Atendente</th>
              <th class="kt-num">Leads</th>
              <th class="kt-num">Qualificados</th>
              <th class="kt-num">Vendas</th>
              <th class="kt-num">Descartados</th>
              <th class="kt-num">Taxa de venda</th>
              <th class="kt-num">Receita</th>
              <th class="kt-num" title="Do lead chegar até alguém abrir o painel da conversa">Tempo até atender</th>
            </tr>
          </thead>
          <tbody>
            {dados.atendentes.map((a) => (
              <tr key={a.id ?? 'sem'}>
                <td>
                  <span class="kt-pessoa">
                    <Avatar nome={a.id ? a.nome : null} />
                    {a.nome}
                  </span>
                </td>
                <td class="kt-num">{inteiro(a.entradas)}</td>
                <td class="kt-num">{inteiro(a.qualificados)}</td>
                <td class="kt-num">{inteiro(a.vendas)}</td>
                <td class="kt-num">{inteiro(a.descartados)}</td>
                <td class="kt-num">
                  <span class="kt-taxa">
                    <span class="kt-taxa-trilho" aria-hidden="true">
                      <span class="kt-taxa-barra" style={{ width: `${((a.taxaVenda ?? 0) / melhorTaxa) * 100}%` }} />
                    </span>
                    {percentual(a.taxaVenda, 1)}
                  </span>
                </td>
                <td class="kt-num">{dinheiro(a.receita, dados.moeda)}</td>
                <td class="kt-num">{a.minutosAteAtender == null ? '—' : a.minutosAteAtender < 60 ? `${a.minutosAteAtender} min` : `${(a.minutosAteAtender / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="kt-muted">Inclui atendimentos sem anúncio. "Sem atendente": leads que ainda não tiveram o painel aberto por ninguém (só a IA ou a fila).</p>
    </div>
  );
}
