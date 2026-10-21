import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, BotaoCopiar, CaixaChave } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import type { Omni } from '../../comum/omni';
import type { ChavesNovas } from './tipos';

/** As chaves só são mostradas uma vez: ficam no omni.storage do admin até a conta ser confirmada. */
export const CHAVES_PENDENTES = 'chaves-pendentes';

function urlManifest(apiUrl: string, extensao: 'gestao' | 'atendimento'): string {
  return `${apiUrl}/extensao/${extensao}/manifest.json`;
}

export function ChavesCriadas({ chaves, apiUrl }: { chaves: ChavesNovas; apiUrl: string }) {
  return (
    <section class="kt-card kt-chaves-criadas">
      <h2>
        <Icone nome="check" tamanho={18} /> Conta criada. Agora cole as chaves.
      </h2>
      <Aviso>
        As chaves aparecem <strong>só agora</strong>. Elas ficam guardadas neste navegador até você colar a chave de admin e recarregar a página.
      </Aviso>
      <ol class="kt-passos">
        <li>
          Copie a <strong>chave de admin</strong> e cole em <em>Gestão de extensões › Kentro Track — Gestão › Configuração › Chave do Kentro Track</em>.
          Salve e recarregue esta página.
          <CaixaChave rotulo="Chave de admin" valor={chaves.chaveAdmin}>
            Configura o Kentro Track. Use só na instalação que os administradores recebem.
          </CaixaChave>
        </li>
        <li>
          Instale o <strong>Kentro Track — Atendimento</strong> com o endereço abaixo e cole a <strong>chave de atendimento</strong> na configuração dele.
          <div class="kt-linha-acoes" style={{ margin: '6px 0 10px' }}>
            <code>{urlManifest(apiUrl, 'atendimento')}</code>
            <BotaoCopiar texto={urlManifest(apiUrl, 'atendimento')} aoCopiar="Endereço copiado." />
          </div>
          <CaixaChave rotulo="Chave de atendimento" valor={chaves.chaveAtendimento}>
            Só mostra a origem dos leads no atendimento. Pode ir para todos os atendentes.
          </CaixaChave>
        </li>
        <li>
          <em>Opcional:</em> para supervisores verem os painéis sem poder mudar a configuração, instale o Kentro Track — Gestão de novo, só para
          supervisores, com a <strong>chave de gestor</strong>.
          <CaixaChave rotulo="Chave de gestor" valor={chaves.chaveGestor}>
            Só leitura dos painéis.
          </CaixaChave>
        </li>
      </ol>
    </section>
  );
}

export function PrimeiroUso({ omni, api, apiUrl, nomeSugerido }: { omni: Omni; api: Api; apiUrl: string; nomeSugerido: string }) {
  const [pendentes, setPendentes] = useState<ChavesNovas | null>(null);
  const [nome, setNome] = useState(nomeSugerido);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    omni.storage.get(CHAVES_PENDENTES).then(
      (salvas) => {
        if (salvas && typeof salvas === 'object' && 'chaveAdmin' in salvas) setPendentes(salvas as ChavesNovas);
      },
      () => {},
    );
  }, [omni]);

  if (pendentes) return <ChavesCriadas chaves={pendentes} apiUrl={apiUrl} />;

  const criar = async () => {
    setEnviando(true);
    setErro('');
    try {
      const chaves = await api<ChavesNovas>('/v1/contas/registrar', { method: 'POST', body: nome.trim() ? { nome: nome.trim() } : {} });
      await omni.storage.set(CHAVES_PENDENTES, chaves).catch(() => {});
      setPendentes(chaves);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section class="kt-card kt-boas-vindas">
      <span class="kt-marca kt-marca-grande" aria-hidden="true">
        <Icone nome="grafico" tamanho={28} />
      </span>
      <h1>Bem-vindo ao Kentro Track</h1>
      <p class="kt-boas-vindas-texto">
        Veja o resultado das suas campanhas do Meta até a venda: investimento, leads, custo por lead e o que virou venda no atendimento.
      </p>
      <ul class="kt-beneficios">
        <li>
          <Icone nome="megafone" tamanho={16} /> Campanhas, criativos e custo por lead, atualizados de hora em hora
        </li>
        <li>
          <Icone nome="mensagem" tamanho={16} /> O atendente vê de qual anúncio cada lead veio
        </li>
        <li>
          <Icone nome="raio" tamanho={16} /> Vendas voltam para o pixel e o Meta otimiza para quem compra
        </li>
      </ul>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <label class="kt-campo">
        <span>Nome da empresa</span>
        <input value={nome} maxLength={120} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
      </label>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={enviando} onClick={criar}>
          {enviando ? 'Criando…' : 'Criar minha conta no Kentro Track'}
        </button>
      </div>
      <p class="kt-muted" style={{ marginTop: '12px' }}>
        Já tem uma chave? Cole em <em>Gestão de extensões › Kentro Track — Gestão › Configuração</em> e recarregue a página.
      </p>
    </section>
  );
}
