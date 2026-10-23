import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Interruptor, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';
import { SeletorEvento } from './eventos-meta';
import type { EtapaFunil, TipoEtapa } from './tipos';

/** Etapa em edição: a nova ainda não tem id nem chave (a API cria a partir do nome). */
type Rascunho = Omit<EtapaFunil, 'id' | 'chave' | 'ordem'> & { id?: string; chave?: string; local: string };

const TIPOS: { id: TipoEtapa; rotulo: string; ajuda: string }[] = [
  { id: 'andamento', rotulo: 'Andamento', ajuda: 'Um passo do funil (engajou, agendou, visitou…).' },
  { id: 'venda', rotulo: 'Venda', ajuda: 'Pede o valor: entra na receita e no ROAS.' },
  { id: 'perda', rotulo: 'Perda', ajuda: 'Pede o motivo: o lead sai do funil.' },
];

let sequencia = 0;
// Sem a ordem: ela é a posição na lista (e assim dá para comparar com o que está salvo).
const deEtapa = ({ ordem: _, ...e }: EtapaFunil): Rascunho => ({ ...e, local: e.id });
const nova = (): Rascunho => ({
  local: `nova-${++sequencia}`,
  nome: '',
  tipo: 'andamento',
  qualificada: false,
  eventoMeta: null,
  botaoAtendente: true,
  noPainel: true,
  ativa: true,
});

/** Configurações › Etapas do funil: o que o atendente marca, o que os painéis contam e o que vai ao Meta. */
export function EtapasFunil({ api }: { api: Api }) {
  const [salvas, setSalvas] = useState<EtapaFunil[] | null>(null);
  const [lista, setLista] = useState<Rascunho[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const receber = (etapas: EtapaFunil[] | undefined) => {
    const lista = Array.isArray(etapas) ? etapas : [];
    setSalvas(lista);
    setLista(lista.map(deEtapa));
  };
  useEffect(() => {
    api<{ etapas: EtapaFunil[] }>('/v1/etapas').then((r) => receber(r.etapas), (e) => setErro(mensagemDeErro(e)));
  }, [api]);

  if (!salvas) {
    return (
      <Secao icone="funil" titulo="Etapas do funil">
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />}
      </Secao>
    );
  }

  const alterado = JSON.stringify(lista.map(({ local: _, ...e }) => e)) !== JSON.stringify(salvas.map(({ ordem: _, ...e }) => e));
  const mudar = (local: string, mudanca: Partial<Rascunho>) => setLista((l) => l.map((e) => (e.local === local ? { ...e, ...mudanca } : e)));
  const mover = (i: number, passo: -1 | 1) =>
    setLista((l) => {
      const copia = [...l];
      [copia[i], copia[i + passo]] = [copia[i + passo], copia[i]];
      return copia;
    });

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const etapas = lista.map(({ local: _, chave: __, ...e }) => e);
      receber((await api<{ etapas: EtapaFunil[] }>('/v1/etapas', { method: 'PUT', body: { etapas } })).etapas);
      avisar('Etapas do funil salvas.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Secao
      icone="funil"
      titulo="Etapas do funil"
      descricao="O que o atendente marca na conversa, o que os painéis contam e o que vai para o Meta. A ordem é a do funil: quem chega a uma etapa conta nas anteriores."
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ol class="kt-etapas-funil">
        {lista.map((e, i) => (
          <li key={e.local} class={e.ativa ? '' : 'kt-etapa-desativada'}>
            <div class="kt-etapa-linha">
              <span class="kt-etapa-ordem" aria-hidden="true">
                {i + 1}
              </span>
              <label class="kt-campo kt-etapa-nome">
                <span>Nome</span>
                <input value={e.nome} maxLength={40} placeholder="Ex.: Agendou" onInput={(ev) => mudar(e.local, { nome: (ev.target as HTMLInputElement).value })} />
              </label>
              <label class="kt-campo">
                <span>Tipo</span>
                <span class="kt-select">
                  <select value={e.tipo} onChange={(ev) => mudar(e.local, { tipo: (ev.target as HTMLSelectElement).value as TipoEtapa })}>
                    {TIPOS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.rotulo}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <div class="kt-campo">
                <span>Evento no Meta</span>
                <SeletorEvento valor={e.eventoMeta} mudar={(v) => mudar(e.local, { eventoMeta: v })} />
              </div>
              <div class="kt-etapa-mover">
                <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" aria-label={`Subir ${e.nome || 'etapa'}`} disabled={i === 0} onClick={() => mover(i, -1)}>
                  <Icone nome="cima" tamanho={14} />
                </button>
                <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" aria-label={`Descer ${e.nome || 'etapa'}`} disabled={i === lista.length - 1} onClick={() => mover(i, 1)}>
                  <Icone nome="baixo" tamanho={14} />
                </button>
                <button
                  type="button"
                  class="kt-botao kt-botao-perigo kt-botao-pequeno"
                  aria-label={`Excluir ${e.nome || 'etapa'}`}
                  title="Etapa que já tem leads não é excluída: desative."
                  onClick={() => setLista((l) => l.filter((x) => x.local !== e.local))}
                >
                  <Icone nome="lixeira" tamanho={14} />
                </button>
              </div>
            </div>
            <p class="kt-muted kt-etapa-ajuda">{TIPOS.find((t) => t.id === e.tipo)?.ajuda}</p>
            <div class="kt-etapa-chaves">
              {e.tipo === 'andamento' && (
                <Interruptor ligado={e.qualificada} mudar={(v) => mudar(e.local, { qualificada: v })}>
                  Conta como qualificado
                </Interruptor>
              )}
              <Interruptor ligado={e.botaoAtendente} mudar={(v) => mudar(e.local, { botaoAtendente: v })}>
                Botão no atendimento
              </Interruptor>
              <Interruptor ligado={e.noPainel} mudar={(v) => mudar(e.local, { noPainel: v })}>
                Aparece nos painéis
              </Interruptor>
              <Interruptor ligado={e.ativa} mudar={(v) => mudar(e.local, { ativa: v })}>
                Ativa
              </Interruptor>
              {e.chave && <span class="kt-muted kt-etapa-chave" title="Nome do evento na automação da Kentro">evento: {e.chave}</span>}
            </div>
          </li>
        ))}
      </ol>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao kt-botao-secundario" onClick={() => setLista((l) => [...l, nova()])}>
          <Icone nome="mais" tamanho={15} />
          Adicionar etapa
        </button>
        <button type="button" class="kt-botao" disabled={!alterado || salvando || lista.some((e) => !e.nome.trim())} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar etapas'}
        </button>
        {alterado && (
          <button type="button" class="kt-link" onClick={() => receber(salvas)}>
            Descartar mudanças
          </button>
        )}
      </div>
    </Secao>
  );
}
