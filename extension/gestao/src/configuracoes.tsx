import { useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, CaixaChave, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import type { Omni } from '../../comum/omni';
import { ConexaoMeta } from './conexao-meta';
import { EventosMeta } from './eventos-meta';
import { IntegracaoAtendimento } from './integracao';
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
    <Secao icone="chave" titulo="Chaves" descricao="Cada extensão usa a sua. Gere uma nova se alguma vazou ou se alguém com acesso saiu da empresa.">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {CHAVES.map(({ tipo, rotulo, ondeColar }) => (
        <div key={tipo} class="kt-chave-linha">
          <div class="kt-chave-linha-topo">
            <span class="kt-chave-linha-icone">
              <Icone nome="chave" tamanho={15} />
            </span>
            <div class="kt-chave-linha-texto">
              <strong>{rotulo}</strong>
              <span class="kt-muted">{ondeColar}</span>
            </div>
            <button type="button" class="kt-botao kt-botao-perigo kt-botao-pequeno" disabled={girando !== null} onClick={() => rotacionar(tipo, rotulo, ondeColar)}>
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
    </Secao>
  );
}

export function Configuracoes({ omni, api }: { omni: Omni; api: Api }) {
  return (
    <>
      <ConexaoMeta omni={omni} api={api} />
      <IntegracaoAtendimento omni={omni} api={api} />
      <EventosMeta omni={omni} api={api} />
      <Chaves omni={omni} api={api} />
    </>
  );
}
