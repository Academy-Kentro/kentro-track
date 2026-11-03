import { useState } from 'preact/hooks';
import { ErroTrack, mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, Carregando, Interruptor, Secao, Vazio } from '../../comum/componentes';
import { inteiro } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { avisar, type MensagemOmni, type Omni } from '../../comum/omni';
import { useDados } from './filtro';
import { lerValor } from './leads-comum';
import { ConversaLead } from './leads-conversa';

type Confianca = 'alta' | 'media' | 'baixa';

interface Sugestao {
  id: string;
  leadId: string;
  nome: string | null;
  telefone: string | null;
  chatId: string | null;
  confianca: Confianca;
  evidencia: string;
  evidenciaEm: string | null;
  valorSugerido: number | null;
}

interface EtapaInspetor {
  id: string;
  nome: string;
  tipo: 'andamento' | 'venda';
}

interface DadosInspetor {
  disponivel: boolean;
  ativo: boolean;
  limite: number;
  usadas: number;
  etapas: EtapaInspetor[];
  sugestoes: Sugestao[];
}

const ROTULO: Record<Confianca, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const CLASSE: Record<Confianca, string> = { alta: 'venda', media: 'qualificado', baixa: 'novo' };
const MENSAGENS_POR_CONVERSA = 50;

const paraEnvio = (lote: MensagemOmni[]) =>
  [...lote]
    .reverse()
    .filter((m) => typeof m.text === 'string' && m.text.trim())
    .map((m) => {
      const em = m.at == null ? NaN : new Date(m.at).getTime();
      return { id: String(m.id), direcao: String(m.direction ?? 'out').slice(0, 20), texto: m.text!.slice(0, 5000), ...(Number.isNaN(em) ? {} : { em: new Date(em).toISOString() }) };
    });

function LinhaSugestao({ s, etapas, api, aoDecidir, verConversa }: { s: Sugestao; etapas: EtapaInspetor[]; api: Api; aoDecidir: () => void; verConversa: () => void }) {
  const padrao = etapas.find((e) => e.tipo === 'venda') ?? etapas[0];
  const [etapaId, setEtapaId] = useState(padrao?.id ?? '');
  const [valor, setValor] = useState(s.valorSugerido == null ? '' : s.valorSugerido.toFixed(2).replace('.', ','));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const etapa = etapas.find((e) => e.id === etapaId);
  const numero = lerValor(valor);
  const valorOk = etapa?.tipo !== 'venda' || !valor.trim() || (Number.isFinite(numero) && numero >= 0);

  const decidir = async (caminho: string, corpo?: object) => {
    setEnviando(true);
    setErro('');
    try {
      await api(`/v1/inspetor/${s.id}/${caminho}`, { method: 'POST', body: corpo ?? {} });
      aoDecidir();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setEnviando(false);
    }
  };
  return (
    <li class="kt-sugestao">
      <div class="kt-sugestao-topo">
        <strong>{s.nome ?? 'Sem nome'}</strong>
        {s.telefone && <span class="kt-muted">{s.telefone}</span>}
        <span class={`kt-etapa kt-etapa-${CLASSE[s.confianca]}`}>Confiança {ROTULO[s.confianca].toLowerCase()}</span>
        {s.evidenciaEm && <span class="kt-muted">{new Date(s.evidenciaEm).toLocaleDateString('pt-BR')}</span>}
      </div>
      <blockquote class="kt-evidencia">{s.evidencia}</blockquote>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-linha-acoes">
        <label class="kt-select">
          <span class="kt-invisivel">Etapa</span>
          <select value={etapaId} onChange={(e) => setEtapaId((e.target as HTMLSelectElement).value)}>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>
        {etapa?.tipo === 'venda' && <input class="kt-sugestao-valor" aria-label="Valor da venda" inputMode="decimal" placeholder="Valor (R$)" value={valor} onInput={(e) => setValor((e.target as HTMLInputElement).value)} />}
        <button
          type="button"
          class="kt-botao kt-botao-sucesso kt-botao-pequeno"
          disabled={enviando || !etapa || !valorOk}
          onClick={() => decidir('aprovar', { etapa: etapaId, ...(etapa?.tipo === 'venda' && valor.trim() ? { valor: Math.round(numero * 100) / 100 } : {}) })}
        >
          Aprovar
        </button>
        <button type="button" class="kt-botao kt-botao-perigo kt-botao-pequeno" disabled={enviando} onClick={() => decidir('recusar')}>
          Recusar
        </button>
        {s.chatId && (
          <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={verConversa}>
            Ver conversa
          </button>
        )}
      </div>
    </li>
  );
}

/** Lê conversas pela Kentro quando alguém pede, sugere as vendas e deixa a decisão com a pessoa. */
export function Inspetor({ omni, api, q, admin }: { omni: Omni; api: Api; q: string; admin: boolean }) {
  const carga = useDados<DadosInspetor>(api, '/v1/inspetor');
  const { dados, erro } = carga;
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null);
  const [falha, setFalha] = useState('');
  const [aviso, setAviso] = useState('');
  const [conversa, setConversa] = useState<Sugestao | null>(null);
  const [filtro, setFiltro] = useState<'' | Confianca>('');
  const [ocupado, setOcupado] = useState(false);

  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;

  const ligar = async (ativo: boolean) => {
    setFalha('');
    try {
      await api('/v1/inspetor/ligado', { method: 'PUT', body: { ativo } });
      carga.recarregar?.();
    } catch (e) {
      setFalha(mensagemDeErro(e));
    }
  };

  const analisar = async () => {
    setFalha('');
    setAviso('');
    setProgresso({ feitas: 0, total: 0 });
    let achadas = 0;
    let semLeitura = 0;
    try {
      const { itens } = await api<{ itens: { leadId: string; chatId: string }[] }>(`/v1/inspetor/candidatos?${q}`);
      setProgresso({ feitas: 0, total: itens.length });
      for (const [i, item] of itens.entries()) {
        let lote: MensagemOmni[];
        try {
          lote = await omni.chats.getMessages(Number(item.chatId), { limit: MENSAGENS_POR_CONVERSA });
        } catch {
          lote = [];
        }
        // Sem mensagens lidas, nada foi analisado: a conversa não pode ser marcada como lida.
        if (!Array.isArray(lote) || lote.length === 0) {
          semLeitura++;
          setProgresso({ feitas: i + 1, total: itens.length });
          continue;
        }
        const { sugestao } = await api<{ sugestao: unknown }>('/v1/inspetor/analisar', { method: 'POST', body: { leadId: item.leadId, mensagens: paraEnvio(lote) } });
        if (sugestao) achadas++;
        setProgresso({ feitas: i + 1, total: itens.length });
      }
      setAviso(
        itens.length === 0
          ? 'Nenhuma conversa nova para analisar neste período.'
          : `${inteiro(itens.length - semLeitura)} ${itens.length - semLeitura === 1 ? 'conversa analisada' : 'conversas analisadas'}, ${inteiro(achadas)} com possível venda.${semLeitura ? ` ${inteiro(semLeitura)} não ${semLeitura === 1 ? 'pôde ser lida' : 'puderam ser lidas'} pela Kentro e ${semLeitura === 1 ? 'continua' : 'continuam'} na fila.` : ''}`,
      );
    } catch (e) {
      const codigo = (e as ErroTrack)?.codigo;
      setFalha(codigo === 'LIMITE_MENSAL' || codigo === 'INSPETOR_DESLIGADO' ? mensagemDeErro(e) : `A análise parou no meio. ${mensagemDeErro(e)}`);
    } finally {
      setProgresso(null);
      carga.recarregar?.();
    }
  };

  const visiveis = dados.sugestoes.filter((s) => !filtro || s.confianca === filtro);

  const aprovarTodos = async () => {
    const venda = dados.etapas.find((e) => e.tipo === 'venda');
    if (!venda) return;
    const r = await omni.ui
      .confirm({
        title: 'Aprovar todas',
        message: `${inteiro(visiveis.length)} conversas vão para "${venda.nome}", com o valor sugerido (ou R$ 0). Se o Meta estiver configurado, o evento de cada uma é enviado e não volta atrás.`,
        okLabel: 'Aprovar todas',
      })
      .catch(() => ({ confirmed: false }));
    if (!r.confirmed) return;
    setOcupado(true);
    setFalha('');
    try {
      for (const s of visiveis) await api(`/v1/inspetor/${s.id}/aprovar`, { method: 'POST', body: { etapa: venda.id } });
      avisar('Vendas aprovadas.');
    } catch (e) {
      setFalha(`Parou no meio: as anteriores já foram aprovadas. ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(false);
      carga.recarregar?.();
    }
  };

  return (
    <div>
      {conversa?.chatId && <ConversaLead key={conversa.id} omni={omni} lead={conversa} fechar={() => setConversa(null)} />}
      <Secao
        icone="estrela"
        titulo="Inspetor de Vendas"
        descricao="A IA lê as conversas e sugere as que têm evidência de venda. Quem decide é sempre uma pessoa."
        acoes={
          dados.ativo && (
            <button type="button" class="kt-botao" disabled={!!progresso || !dados.disponivel} onClick={analisar}>
              <Icone nome="raio" tamanho={15} />
              {progresso ? `Analisando… ${inteiro(progresso.feitas)} de ${inteiro(progresso.total)}` : 'Analisar conversas'}
            </button>
          )
        }
      >
        {!dados.disponivel && <Aviso tipo="erro">A chave da IA ainda não foi configurada no servidor do Kentro Track (variável ANTHROPIC_API_KEY).</Aviso>}
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
        {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
        <div class="kt-inspetor-uso">
          <span class="kt-muted">Limite mensal</span>
          <div class="kt-taxa-trilho" aria-hidden="true">
            <span class="kt-taxa-barra" style={{ width: `${Math.min(100, (dados.usadas / dados.limite) * 100)}%` }} />
          </div>
          <span>
            {inteiro(dados.usadas)} de {inteiro(dados.limite)} conversas analisadas
          </span>
        </div>
        {admin && (
          <div class="kt-inspetor-ligar">
            <Interruptor ligado={dados.ativo} mudar={ligar}>
              Ligar o Inspetor nesta conta
            </Interruptor>
            <p class="kt-muted">
              Ao ligar, o texto das conversas analisadas é enviado à Anthropic, a empresa da IA. O Kentro Track guarda só a mensagem usada como evidência. Confirme que os clientes da conta estão cientes desse uso.
            </p>
          </div>
        )}
        {!dados.ativo && !admin && <Aviso>O administrador precisa ligar o Inspetor nesta conta.</Aviso>}
        {dados.ativo && <p class="kt-muted">Cada clique analisa até 20 conversas do período escolhido acima que tiveram mensagem nova. Só texto: áudio e imagem não são lidos.</p>}
      </Secao>
      <Secao
        icone="check"
        titulo="Vendas para revisar"
        acoes={
          dados.sugestoes.length > 0 && (
            <span class="kt-linha-acoes">
              <label class="kt-select">
                <span class="kt-invisivel">Confiança</span>
                <select value={filtro} onChange={(e) => setFiltro((e.target as HTMLSelectElement).value as '' | Confianca)}>
                  <option value="">Todas as confianças</option>
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </label>
              <button type="button" class="kt-botao kt-botao-secundario kt-botao-pequeno" disabled={ocupado || visiveis.length === 0} onClick={aprovarTodos}>
                Aprovar todas
              </button>
            </span>
          )
        }
      >
        {visiveis.length === 0 ? (
          <Vazio icone="check" titulo="Nenhuma venda para revisar" />
        ) : (
          <ul class="kt-sugestoes">
            {visiveis.map((s) => (
              <LinhaSugestao key={s.id} s={s} etapas={dados.etapas} api={api} aoDecidir={() => carga.recarregar?.()} verConversa={() => setConversa(s)} />
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}
