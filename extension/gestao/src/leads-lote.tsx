import { useState } from 'preact/hooks';
import { mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, Secao } from '../../comum/componentes';
import { dinheiro, inteiro } from '../../comum/formato';
import { lerValor } from './leads-comum';
import type { EtapaFunil } from './tipos';

/** Os mesmos limites da API (MAX_TELEFONES_LOTE e MAX_LEADS_POR_CHAMADA). */
const MAX_TELEFONES = 500;
const LEADS_POR_CHAMADA = 50;

interface Conferencia {
  encontrados: { id: string; nome: string | null; telefone: string | null; etapaId: string | null; etapa: string; etapaNome: string | null; entradas: number }[];
  naoEncontrados: string[];
  invalidos: string[];
}

interface Resultado {
  alterados: number;
  jaNaEtapa: number;
  naoEncontrados: number;
  erros: { id: string; mensagem: string }[];
}

const SITUACAO: Record<string, string> = { novo: 'Novo', em_atendimento: 'Em atendimento', qualificado: 'Qualificado', venda: 'Venda', descartado: 'Descartado' };

export const separarTelefones = (texto: string): string[] => [
  ...new Set(
    texto
      .split(/[\n,;]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

const PASSOS = ['Inserir os números', 'Conferir', 'Confirmar'];

export function TrocaEmLote({ api, etapas, aoConcluir }: { api: Api; etapas: EtapaFunil[]; aoConcluir: () => void }) {
  const [passo, setPasso] = useState(0);
  const [texto, setTexto] = useState('');
  const [alvoId, setAlvoId] = useState('');
  const [detalhe, setDetalhe] = useState('');
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const ativas = etapas.filter((e) => e.ativa);
  const etapa = ativas.find((e) => e.id === alvoId);
  const nomeAlvo = alvoId === 'em_atendimento' ? 'Em atendimento' : etapa?.nome ?? '';
  const telefones = separarTelefones(texto);
  const valor = lerValor(detalhe);
  const detalheOk = etapa?.tipo === 'venda' ? !!detalhe.trim() && Number.isFinite(valor) && valor >= 0 : etapa?.tipo === 'perda' ? !!detalhe.trim() : true;
  const encontrados = conferencia?.encontrados ?? [];

  const recomecar = () => {
    setPasso(0);
    setTexto('');
    setAlvoId('');
    setDetalhe('');
    setConferencia(null);
    setResultado(null);
    setErro('');
  };

  const conferir = async () => {
    setEnviando(true);
    setErro('');
    try {
      setConferencia(await api<Conferencia>('/v1/painel/leads/lote/conferir', { method: 'POST', body: { telefones } }));
      setPasso(1);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const aplicar = async () => {
    setEnviando(true);
    setErro('');
    setProgresso(0);
    const total: Resultado = { alterados: 0, jaNaEtapa: 0, naoEncontrados: 0, erros: [] };
    const extra = etapa?.tipo === 'venda' ? { valor: Math.round(valor * 100) / 100 } : etapa?.tipo === 'perda' ? { motivo: detalhe.trim() } : {};
    try {
      // Em partes: se uma cair, as anteriores já valeram, e a tela conta quantas.
      for (let i = 0; i < encontrados.length; i += LEADS_POR_CHAMADA) {
        const parte = encontrados.slice(i, i + LEADS_POR_CHAMADA).map((l) => l.id);
        const r = await api<Resultado>('/v1/painel/leads/lote/etapa', { method: 'POST', body: { leads: parte, etapa: alvoId, ...extra } });
        total.alterados += r.alterados;
        total.jaNaEtapa += r.jaNaEtapa;
        total.naoEncontrados += r.naoEncontrados;
        total.erros.push(...r.erros);
        setProgresso(i + parte.length);
      }
    } catch (e) {
      setErro(`${mensagemDeErro(e)} ${inteiro(total.alterados)} ${total.alterados === 1 ? 'lead já foi alterado' : 'leads já foram alterados'} antes da falha.`);
    } finally {
      setEnviando(false);
      setResultado(total);
      aoConcluir();
    }
  };

  return (
    <Secao icone="lista" titulo="Trocar a etapa em lote" descricao="Cole os números e leve todos para a mesma etapa. Nada muda antes da confirmação.">
      <ol class="kt-passos-lote">
        {PASSOS.map((p, i) => (
          <li key={p} aria-current={i === passo ? 'step' : undefined} class={i === passo ? 'kt-passo-atual' : ''}>
            <span class="kt-passo-n">{i + 1}</span> {p}
          </li>
        ))}
      </ol>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {passo === 0 && (
        <>
          <label class="kt-campo">
            <span>Números das conversas</span>
            <textarea rows={5} value={texto} placeholder="38999990000, 38988880000" onInput={(e) => setTexto((e.target as HTMLTextAreaElement).value)} />
            <span class="kt-campo-ajuda kt-muted">Separados por vírgula ou um por linha, com ou sem formatação. Até {inteiro(MAX_TELEFONES)} de uma vez.</span>
          </label>
          <label class="kt-campo">
            <span>Levar para a etapa</span>
            <select
              value={alvoId}
              onChange={(e) => {
                setAlvoId((e.target as HTMLSelectElement).value);
                setDetalhe('');
              }}
            >
              <option value="">Escolha uma etapa</option>
              <option value="em_atendimento">Em atendimento</option>
              {ativas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </label>
          {(etapa?.tipo === 'venda' || etapa?.tipo === 'perda') && (
            <label class="kt-campo">
              <span>{etapa.tipo === 'venda' ? 'Valor da venda (R$), o mesmo para cada lead' : 'Motivo, o mesmo para cada lead'}</span>
              <input inputMode={etapa.tipo === 'venda' ? 'decimal' : 'text'} placeholder={etapa.tipo === 'venda' ? '0,00' : ''} maxLength={etapa.tipo === 'venda' ? 20 : 200} value={detalhe} onInput={(e) => setDetalhe((e.target as HTMLInputElement).value)} />
            </label>
          )}
          {telefones.length > MAX_TELEFONES && <Aviso tipo="erro">São {inteiro(telefones.length)} números: o limite é {inteiro(MAX_TELEFONES)} de uma vez.</Aviso>}
          <button type="button" class="kt-botao" disabled={enviando || telefones.length === 0 || telefones.length > MAX_TELEFONES || !alvoId || !detalheOk} onClick={conferir}>
            {enviando ? 'Conferindo…' : 'Conferir números'}
          </button>
        </>
      )}

      {passo === 1 && conferencia && (
        <>
          <p>
            <strong>{inteiro(encontrados.length)}</strong> {encontrados.length === 1 ? 'lead encontrado' : 'leads encontrados'}.
          </p>
          {conferencia.naoEncontrados.length > 0 && <Aviso>Sem lead no Kentro Track, ficam de fora: {conferencia.naoEncontrados.join(', ')}</Aviso>}
          {conferencia.invalidos.length > 0 && <Aviso tipo="erro">Não parecem telefones, ficam de fora: {conferencia.invalidos.join(', ')}</Aviso>}
          {encontrados.length > 0 && (
            <div class="kt-tabela-rolagem kt-lote-tabela">
              <table class="kt-tabela">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Etapa atual</th>
                    <th class="kt-num">Entradas</th>
                  </tr>
                </thead>
                <tbody>
                  {encontrados.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.nome ?? 'Sem nome'}
                        {l.telefone && <span class="kt-muted"> · {l.telefone}</span>}
                      </td>
                      <td>{l.etapaNome ?? SITUACAO[l.etapa] ?? l.etapa}</td>
                      <td class="kt-num">{inteiro(l.entradas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {encontrados.some((l) => l.entradas > 1) && <p class="kt-muted">Quem tem mais de uma entrada: muda só a mais recente.</p>}
          <div class="kt-linha-acoes">
            <button type="button" class="kt-botao" disabled={encontrados.length === 0} onClick={() => setPasso(2)}>
              Continuar
            </button>
            <button type="button" class="kt-botao kt-botao-fantasma" onClick={() => setPasso(0)}>
              Voltar
            </button>
          </div>
        </>
      )}

      {passo === 2 && !resultado && (
        <>
          <p>
            Levar <strong>{inteiro(encontrados.length)}</strong> {encontrados.length === 1 ? 'lead' : 'leads'} para <strong>{nomeAlvo}</strong>
            {etapa?.tipo === 'venda' && <> com {dinheiro(valor)} em cada um</>}
            {etapa?.tipo === 'perda' && <> com o motivo "{detalhe.trim()}"</>}.
          </p>
          {etapa?.tipo === 'venda' && <Aviso>A receita e o ROAS sobem {dinheiro(Math.round(valor * 100) / 100 * encontrados.length)} no total.</Aviso>}
          <Aviso>Se o Meta estiver configurado, cada lead alterado envia o evento desta etapa e das anteriores. Evento enviado não volta atrás.</Aviso>
          <div class="kt-linha-acoes">
            <button type="button" class="kt-botao" disabled={enviando} onClick={aplicar}>
              {enviando ? `Alterando… ${inteiro(progresso)} de ${inteiro(encontrados.length)}` : 'Confirmar a troca'}
            </button>
            <button type="button" class="kt-botao kt-botao-fantasma" disabled={enviando} onClick={() => setPasso(1)}>
              Voltar
            </button>
          </div>
        </>
      )}

      {resultado && (
        <>
          <Aviso tipo={resultado.erros.length > 0 ? 'erro' : 'ok'}>
            {inteiro(resultado.alterados)} {resultado.alterados === 1 ? 'lead alterado' : 'leads alterados'}
            {resultado.jaNaEtapa > 0 && `, ${inteiro(resultado.jaNaEtapa)} já ${resultado.jaNaEtapa === 1 ? 'estava' : 'estavam'} nesta etapa`}
            {resultado.erros.length > 0 && `, ${inteiro(resultado.erros.length)} com erro`}.
          </Aviso>
          <button type="button" class="kt-botao kt-botao-secundario" onClick={recomecar}>
            Nova troca
          </button>
        </>
      )}
    </Secao>
  );
}
