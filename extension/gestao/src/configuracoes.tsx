import { useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, CaixaChave } from '../../comum/componentes';
import type { Omni } from '../../comum/omni';
import { ConexaoMeta } from './conexao-meta';
import type { Papel } from './tipos';

const CHAVES: { tipo: Papel; rotulo: string; ondeColar: string }[] = [
  { tipo: 'admin', rotulo: 'Chave de admin', ondeColar: 'Kentro Track — Gestão (instalação dos administradores)' },
  { tipo: 'gestor', rotulo: 'Chave de gestor', ondeColar: 'Kentro Track — Gestão (instalação dos supervisores)' },
  { tipo: 'atendimento', rotulo: 'Chave de atendimento', ondeColar: 'Kentro Track — Atendimento' },
];

function Chaves({ omni, api }: { omni: Omni; api: Api }) {
  const [nova, setNova] = useState<{ tipo: Papel; chave: string } | null>(null);
  const [erro, setErro] = useState('');
  const [girando, setGirando] = useState<Papel | null>(null);

  const rotacionar = async (tipo: Papel, rotulo: string, ondeColar: string) => {
    const escolha = await omni.ui
      .confirm({
        title: `Gerar nova ${rotulo.toLowerCase()}`,
        message: `A chave atual para de funcionar na hora. Você vai precisar colar a nova em ${ondeColar}.`,
        okLabel: 'Gerar nova',
      })
      .catch(() => ({ confirmed: false }));
    if (!escolha.confirmed) return;
    setGirando(tipo);
    setErro('');
    try {
      const { chave } = await api<{ chave: string }>(`/v1/conta/chaves/${tipo}/rotacionar`, { method: 'POST' });
      setNova({ tipo, chave });
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setGirando(null);
    }
  };

  return (
    <section class="kt-card">
      <h2>Chaves</h2>
      <p class="kt-muted">Cada extensão usa a sua chave. Gere uma nova se alguma vazou ou se alguém com acesso saiu da empresa.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {CHAVES.map(({ tipo, rotulo, ondeColar }) => (
        <div key={tipo} style={{ marginBottom: '12px' }}>
          <div class="kt-linha-acoes">
            <strong style={{ minWidth: '170px' }}>{rotulo}</strong>
            <span class="kt-muted">{ondeColar}</span>
            <button type="button" class="kt-botao kt-botao-perigo" disabled={girando !== null} onClick={() => rotacionar(tipo, rotulo, ondeColar)}>
              {girando === tipo ? 'Gerando…' : 'Gerar nova'}
            </button>
          </div>
          {nova?.tipo === tipo && (
            <CaixaChave rotulo={`Nova ${rotulo.toLowerCase()}`} valor={nova.chave}>
              Aparece só agora. Cole em {ondeColar} › Configuração{tipo === 'admin' ? ' e recarregue esta página' : ''}.
            </CaixaChave>
          )}
        </div>
      ))}
    </section>
  );
}

export function Configuracoes({ omni, api }: { omni: Omni; api: Api }) {
  return (
    <>
      <ConexaoMeta omni={omni} api={api} />
      <Chaves omni={omni} api={api} />
    </>
  );
}
