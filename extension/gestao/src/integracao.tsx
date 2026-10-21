import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando } from '../../comum/componentes';
import type { Omni } from '../../comum/omni';

interface Integracao {
  url: string;
  exemplos: Record<'chat_iniciado' | 'qualificado' | 'venda' | 'descartado', Record<string, unknown>>;
}

const EVENTOS: { id: keyof Integracao['exemplos']; titulo: string; onde: string }[] = [
  {
    id: 'chat_iniciado',
    titulo: 'Atendimento iniciado (recomendado)',
    onde: 'No começo da URA/automação de entrada da fila do WhatsApp, antes de qualquer menu. Conta também os leads que só a IA atendeu.',
  },
  { id: 'qualificado', titulo: 'Qualificado (opcional)', onde: 'Na automação disparada quando a oportunidade entra na etapa de qualificado do funil.' },
  { id: 'venda', titulo: 'Venda (opcional)', onde: 'Na automação disparada quando a oportunidade é ganha. O valor vem da oportunidade.' },
  { id: 'descartado', titulo: 'Descartado (opcional)', onde: 'Na automação disparada quando a oportunidade é perdida.' },
];

/** A automação da Kentro avisa o Kentro Track pelo elemento de requisição HTTP (POST com JSON). */
export function IntegracaoAtendimento({ omni, api }: { omni: Omni; api: Api }) {
  const [dados, setDados] = useState<Integracao | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<Integracao>('/v1/kentro/integracao').then(setDados, (e) => setErro(mensagemDeErro(e)));
  }, [api]);

  const rotacionar = async () => {
    const r = await omni.ui
      .confirm({
        title: 'Gerar nova URL',
        message: 'A URL atual para de funcionar na hora: troque-a em todas as automações da Kentro que a usam.',
        okLabel: 'Gerar nova',
      })
      .catch(() => ({ confirmed: false }));
    if (!r.confirmed) return;
    try {
      setDados(await api<Integracao>('/v1/kentro/integracao/rotacionar', { method: 'POST' }));
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <section class="kt-card">
      <h2>Integração com o atendimento</h2>
      <p>
        O painel <strong>Origem do lead</strong> já registra cada conversa aberta por um atendente. Para contar também os leads que só a IA ou a fila
        atenderam, e para as vendas marcadas no CRM entrarem no ROAS, adicione um elemento de <strong>requisição HTTP</strong> nas automações abaixo.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <Carregando />
      ) : (
        <>
          <div class="kt-chave">
            <div class="kt-chave-topo">
              <strong>URL (método POST, corpo JSON)</strong>
              <BotaoCopiar texto={dados.url} aoCopiar="URL copiada." />
            </div>
            <code class="kt-chave-valor">{dados.url}</code>
            <div class="kt-muted">Quem tiver esta URL consegue registrar eventos nesta conta: não compartilhe fora das automações.</div>
          </div>
          {EVENTOS.map((e) => {
            const corpo = JSON.stringify(dados.exemplos[e.id], null, 2);
            return (
              <details key={e.id} class="kt-evento" open={e.id === 'chat_iniciado'}>
                <summary>
                  <strong>{e.titulo}</strong>
                </summary>
                <p class="kt-muted">{e.onde}</p>
                <pre class="kt-json">{corpo}</pre>
                <div class="kt-linha-acoes" style={{ marginTop: '6px' }}>
                  <BotaoCopiar texto={corpo} rotulo="Copiar corpo" aoCopiar="Corpo copiado." />
                </div>
              </details>
            );
          })}
          <div class="kt-linha-acoes" style={{ marginTop: '12px' }}>
            <button type="button" class="kt-botao kt-botao-perigo" onClick={rotacionar}>
              Gerar nova URL
            </button>
          </div>
        </>
      )}
    </section>
  );
}
