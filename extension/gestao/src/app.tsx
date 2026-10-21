import { useEffect, useMemo, useState } from 'preact/hooks';
import { criarApi, ErroTrack, lerConfigInstalacao, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando } from '../../comum/componentes';
import type { CtxOmni, Omni } from '../../comum/omni';
import { Configuracoes } from './configuracoes';
import { CHAVES_PENDENTES, PrimeiroUso } from './primeiro-uso';
import type { Conta } from './tipos';

type Estado = { tipo: 'carregando' } | { tipo: 'sem_chave' } | { tipo: 'erro'; mensagem: string; chaveInvalida: boolean } | { tipo: 'ok'; conta: Conta };

const ABAS = [
  { id: 'visao', titulo: 'Visão geral' },
  { id: 'campanhas', titulo: 'Campanhas' },
  { id: 'criativos', titulo: 'Criativos' },
  { id: 'leads', titulo: 'Leads' },
  { id: 'equipe', titulo: 'Equipe' },
  { id: 'config', titulo: 'Configurações', soAdmin: true },
] as const;

type IdAba = (typeof ABAS)[number]['id'];

const PAPEL: Record<Conta['papel'], string> = { admin: 'Administrador', gestor: 'Gestor', atendimento: 'Atendimento' };

function EmBreve({ titulo }: { titulo: string }) {
  return (
    <section class="kt-card">
      <h2>{titulo}</h2>
      <p class="kt-muted">Os números aparecem aqui depois que o Meta for conectado (próxima versão).</p>
    </section>
  );
}

export function App({ omni, ctx }: { omni: Omni; ctx: CtxOmni }) {
  const { apiUrl, chave } = lerConfigInstalacao(ctx, 'chave');
  const api = useMemo(() => criarApi({ omni, apiUrl, chave, ctx }), [omni, apiUrl, chave, ctx]);
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [aba, setAba] = useState<IdAba>('visao');

  useEffect(() => {
    if (!apiUrl) {
      setEstado({ tipo: 'erro', mensagem: 'Falta o endereço da API na configuração da extensão.', chaveInvalida: false });
      return;
    }
    if (!chave) {
      setEstado({ tipo: 'sem_chave' });
      return;
    }
    api<Conta>('/v1/conta').then(
      (conta) => {
        setEstado({ tipo: 'ok', conta });
        // Com a chave de admin colada, as chaves pendentes já cumpriram o papel.
        if (conta.papel === 'admin') omni.storage.remove(CHAVES_PENDENTES).catch(() => {});
      },
      (erro: ErroTrack) => setEstado({ tipo: 'erro', mensagem: mensagemDeErro(erro), chaveInvalida: erro.status === 401 }),
    );
  }, [api, apiUrl, chave, omni]);

  if (estado.tipo === 'carregando') return <main class="kt-gestao"><Carregando /></main>;
  if (estado.tipo === 'sem_chave') {
    return (
      <main class="kt-gestao">
        <PrimeiroUso omni={omni} api={api} apiUrl={apiUrl} nomeSugerido={ctx.instance?.name ?? ''} />
      </main>
    );
  }
  if (estado.tipo === 'erro') {
    return (
      <main class="kt-gestao">
        <Aviso tipo="erro">{estado.mensagem}</Aviso>
        {estado.chaveInvalida && <p class="kt-muted">Se a chave foi trocada, cole a nova na configuração da extensão e recarregue a página.</p>}
      </main>
    );
  }

  const { conta } = estado;
  if (conta.papel === 'atendimento') {
    return (
      <main class="kt-gestao">
        <Aviso tipo="erro">
          Esta instalação está com a chave de atendimento. Cole a chave de admin (ou a de gestor) na configuração do Kentro Track — Gestão.
        </Aviso>
      </main>
    );
  }

  const abas = ABAS.filter((a) => !('soAdmin' in a) || conta.papel === 'admin');
  const atual = abas.find((a) => a.id === aba) ?? abas[0];
  return (
    <main class="kt-gestao">
      <header class="kt-topo">
        <div>
          <h1>Kentro Track</h1>
          <p class="kt-muted">
            {conta.nome ?? 'Conta sem nome'} · {PAPEL[conta.papel]}
          </p>
        </div>
        {conta.status === 'pendente_conexao' && <span class="kt-selo">Meta não conectado</span>}
      </header>
      <nav class="kt-abas" role="tablist">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === atual.id} class="kt-aba" onClick={() => setAba(a.id)}>
            {a.titulo}
          </button>
        ))}
      </nav>
      {atual.id === 'config' ? <Configuracoes omni={omni} api={api} conta={conta} /> : <EmBreve titulo={atual.titulo} />}
    </main>
  );
}
