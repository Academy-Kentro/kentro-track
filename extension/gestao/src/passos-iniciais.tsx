import { useEffect, useState } from 'preact/hooks';
import type { Api } from '../../comum/api';
import { Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import type { Omni } from '../../comum/omni';
import { useDados } from './filtro';

interface Passos {
  meta: boolean;
  mensagens: boolean;
  frases: boolean;
  primeiraVenda: boolean;
  link: boolean;
  eventos: boolean;
}

const ITENS: { chave: keyof Passos; rotulo: string }[] = [
  { chave: 'meta', rotulo: 'Conectar o Meta' },
  { chave: 'mensagens', rotulo: 'Receber as mensagens da Kentro (Configurações › Integração com o atendimento)' },
  { chave: 'frases', rotulo: 'Configurar uma frase gatilho (Configurações › Etapas do funil)' },
  { chave: 'link', rotulo: 'Criar o primeiro link rastreável (aba Links)' },
  { chave: 'eventos', rotulo: 'Ligar os eventos para o Meta (Configurações)' },
  { chave: 'primeiraVenda', rotulo: 'Registrar a primeira venda' },
];
const CHAVE_FECHADO = 'passos-iniciais-fechado';

/** Some quando tudo estiver feito, ou quando a pessoa fechar. Falha ao buscar: simplesmente não aparece. */
export function PassosIniciais({ omni, api }: { omni: Omni; api: Api }) {
  const { dados } = useDados<Passos>(api, '/v1/painel/primeiros-passos');
  const [fechado, setFechado] = useState(true);
  useEffect(() => {
    omni.storage.get(CHAVE_FECHADO).then(
      (v) => setFechado(!!v),
      () => setFechado(false),
    );
  }, [omni]);
  if (!dados || fechado || ITENS.every((i) => dados[i.chave])) return null;
  return (
    <Secao
      icone="raio"
      titulo="Configurações iniciais"
      acoes={
        <button
          type="button"
          class="kt-botao kt-botao-fantasma kt-botao-pequeno"
          aria-label="Fechar as configurações iniciais"
          onClick={() => {
            setFechado(true);
            omni.storage.set(CHAVE_FECHADO, true).catch(() => {});
          }}
        >
          <Icone nome="fechar" tamanho={14} />
        </button>
      }
    >
      <ul class="kt-passos-iniciais">
        {ITENS.map((i) => (
          <li key={i.chave} class={dados[i.chave] ? 'kt-passo-feito' : ''}>
            <Icone nome={dados[i.chave] ? 'check' : 'direita'} tamanho={14} />
            {i.rotulo}
          </li>
        ))}
      </ul>
    </Secao>
  );
}
