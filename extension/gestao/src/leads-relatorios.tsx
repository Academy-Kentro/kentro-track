import { useState } from 'preact/hooks';
import { mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, Carregando, Secao, Vazio } from '../../comum/componentes';
import { copiar } from '../../comum/copiar';
import { inteiro } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';
import { useDados } from './filtro';
import { consultaLeads, type FiltroLeads } from './leads-comum';

type TipoExportacao = 'leads' | 'vendas' | 'jornada';

interface Exportacao {
  arquivo: string;
  csv: string;
  linhas: number;
  truncado: boolean;
}

interface DadosAtualizacoes {
  itens: { id: string; nome: string | null; telefone: string | null; texto: string; autor: string; em: string }[];
}

const TIPOS: { id: TipoExportacao; rotulo: string; ajuda: string }[] = [
  { id: 'leads', rotulo: 'Leads', ajuda: 'Os leads que chegaram no período, com os filtros da tela.' },
  { id: 'vendas', rotulo: 'Vendas', ajuda: 'As vendas fechadas no período (pela data da venda), com os filtros da tela.' },
  { id: 'jornada', rotulo: 'Histórico de etapas', ajuda: 'Cada mudança de etapa feita no período, com quem fez.' },
];

/** O arquivo nasce no navegador: a API só é alcançada pelo omni.http.request, que devolve texto. */
function baixar(arquivo: string, csv: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = arquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

export function PainelExportar({ api, q, filtro }: { api: Api; q: string; filtro: FiltroLeads }) {
  const [tipo, setTipo] = useState<TipoExportacao>('leads');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [pronta, setPronta] = useState<Exportacao | null>(null);

  const gerar = async () => {
    setGerando(true);
    setErro('');
    setPronta(null);
    try {
      const consulta = new URLSearchParams(consultaLeads(q, { ...filtro, pagina: 1 }));
      consulta.set('tipo', tipo);
      const resposta = await api<Exportacao>(`/v1/painel/leads/exportar?${consulta}`);
      setPronta(resposta);
      if (resposta.linhas > 0) baixar(resposta.arquivo, resposta.csv);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setGerando(false);
    }
  };

  return (
    <Secao icone="lista" titulo="Exportar para planilha" descricao={TIPOS.find((t) => t.id === tipo)?.ajuda}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-linha-acoes">
        <label class="kt-select">
          <span class="kt-invisivel">Relatório</span>
          <select value={tipo} onChange={(e) => setTipo((e.target as HTMLSelectElement).value as TipoExportacao)}>
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="kt-botao" disabled={gerando} onClick={gerar}>
          {gerando ? 'Gerando…' : 'Gerar CSV'}
        </button>
      </div>
      {pronta &&
        (pronta.linhas === 0 ? (
          <p class="kt-muted kt-exportacao">Nada para exportar com esses filtros no período.</p>
        ) : (
          <div class="kt-exportacao">
            <p>
              <strong>{inteiro(pronta.linhas)}</strong> {pronta.linhas === 1 ? 'linha' : 'linhas'} em {pronta.arquivo}
            </p>
            {pronta.truncado && <Aviso>O relatório foi cortado nas primeiras {inteiro(pronta.linhas)} linhas. Escolha um período menor para ver o resto.</Aviso>}
            <div class="kt-linha-acoes">
              <button type="button" class="kt-botao kt-botao-secundario" onClick={() => baixar(pronta.arquivo, pronta.csv)}>
                Baixar de novo
              </button>
              <button
                type="button"
                class="kt-botao kt-botao-fantasma"
                onClick={async () => {
                  if (await copiar(pronta.csv.replace(/^﻿/, ''))) avisar('CSV copiado.');
                  else avisar('Não foi possível copiar.', 'error');
                }}
              >
                <Icone nome="copiar" tamanho={14} />
                Copiar o conteúdo
              </button>
            </div>
            <p class="kt-muted">Se o download não começar, copie o conteúdo e salve como .csv. O telefone sai parcial, como no painel.</p>
          </div>
        ))}
    </Secao>
  );
}

export function PainelAtualizacoes({ api }: { api: Api }) {
  const { dados, erro } = useDados<DadosAtualizacoes>(api, '/v1/painel/leads/atualizacoes');
  return (
    <Secao icone="historico" titulo="Últimas atualizações" descricao="As 10 mudanças de etapa mais recentes, de qualquer período.">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <Carregando />
      ) : dados.itens.length === 0 ? (
        <Vazio icone="historico" titulo="Nenhuma mudança de etapa ainda" />
      ) : (
        <ul class="kt-atualizacoes">
          {dados.itens.map((a) => (
            <li key={a.id}>
              <span>
                <strong>{a.nome ?? 'Sem nome'}</strong>
                {a.telefone && <span class="kt-muted"> · {a.telefone}</span>}
              </span>
              <span>{a.texto}</span>
              <span class="kt-muted">
                {new Date(a.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {a.autor}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}
