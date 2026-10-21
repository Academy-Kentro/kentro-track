import { useEffect, useMemo, useState } from 'preact/hooks';
import { Api, criarApi, ErroTrack, lerConfigInstalacao, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando } from '../../comum/componentes';
import type { CtxOmni, Omni } from '../../comum/omni';
import { Campanhas } from './campanhas';
import { Configuracoes } from './configuracoes';
import { Criativos } from './criativos';
import { BarraFiltros, consulta, Filtro, PRESETS, useDados } from './filtro';
import { CHAVES_PENDENTES, PrimeiroUso } from './primeiro-uso';
import type { Campanhas as DadosCampanhas, Conta, Criativos as DadosCriativos, Filtros, VisaoGeral as DadosVisao } from './tipos';
import { VisaoGeral } from './visao-geral';

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
const FILTRO_SALVO = 'filtro';
const FILTRO_PADRAO: Filtro = { preset: 'ultimos30', contaAnuncio: '', campanha: '' };
/** Enquanto os 90 dias chegam, as abas se atualizam sozinhas. */
const ATUALIZAR_NA_CARGA_MS = 30_000;

function EmBreve({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <section class="kt-card">
      <h2>{titulo}</h2>
      <p class="kt-muted">{texto}</p>
    </section>
  );
}

function Paineis({ omni, api, conta, aba, irPara }: { omni: Omni; api: Api; conta: Conta; aba: IdAba; irPara: (a: IdAba) => void }) {
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_PADRAO);

  // O filtro é do usuário (omni.storage é por usuário e dispositivo).
  useEffect(() => {
    omni.storage.get(FILTRO_SALVO).then(
      (salvo) => {
        const f = salvo as Partial<Filtro> | null;
        if (f && PRESETS.some((p) => p.id === f.preset)) setFiltro({ ...FILTRO_PADRAO, ...f });
      },
      () => {},
    );
  }, [omni]);
  const mudar = (f: Filtro) => {
    setFiltro(f);
    omni.storage.set(FILTRO_SALVO, f).catch(() => {});
  };

  const opcoes = useDados<Filtros>(api, '/v1/painel/filtros');
  const pendente = !!opcoes.dados?.cargaPendente;
  const intervalo = pendente ? ATUALIZAR_NA_CARGA_MS : undefined;
  // Filtro guardado que aponta para uma conta que saiu da seleção: ignora.
  const valido: Filtro =
    opcoes.dados && filtro.contaAnuncio && !opcoes.dados.contasAnuncio.some((c) => c.id === filtro.contaAnuncio) ? { ...filtro, contaAnuncio: '', campanha: '' } : filtro;
  const q = consulta(valido);
  const pronto = !!opcoes.dados && opcoes.dados.contasAnuncio.length > 0;

  const visao = useDados<DadosVisao>(api, pronto && aba === 'visao' ? `/v1/painel/visao-geral?${q}` : null, intervalo);
  const campanhas = useDados<DadosCampanhas>(api, pronto && aba === 'campanhas' ? `/v1/painel/campanhas?${q}` : null, intervalo);
  const criativos = useDados<DadosCriativos>(api, pronto && aba === 'criativos' ? `/v1/painel/criativos?${q}` : null, intervalo);

  if (aba === 'leads') return <EmBreve titulo="Leads" texto="A lista de leads, com origem, atendente e tempo de resposta, chega com a integração do atendimento (Fase 2)." />;
  if (aba === 'equipe') return <EmBreve titulo="Equipe" texto="Leads, qualificação e vendas por atendente chegam com a integração do atendimento (Fase 2)." />;

  if (!opcoes.dados) return opcoes.erro ? <Aviso tipo="erro">{opcoes.erro}</Aviso> : <Carregando />;
  if (!pronto) {
    return conta.papel === 'admin' ? (
      <Aviso>
        Nenhuma conta de anúncio selecionada.{' '}
        <button type="button" class="kt-link" onClick={() => irPara('config')}>
          Conecte o Meta e marque as contas em Configurações
        </button>
        .
      </Aviso>
    ) : (
      <Aviso>Nenhuma conta de anúncio conectada ainda. Peça ao administrador para conectar o Meta no Kentro Track.</Aviso>
    );
  }

  return (
    <>
      <BarraFiltros filtro={valido} opcoes={opcoes.dados} mudar={mudar} />
      {aba === 'visao' && <VisaoGeral carga={visao} />}
      {aba === 'campanhas' && <Campanhas carga={campanhas} />}
      {aba === 'criativos' && <Criativos carga={criativos} />}
    </>
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
        {conta.status === 'reconectar' && <span class="kt-selo kt-selo-erro">Reconectar o Meta</span>}
      </header>
      <nav class="kt-abas" role="tablist">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === atual.id} class="kt-aba" onClick={() => setAba(a.id)}>
            {a.titulo}
          </button>
        ))}
      </nav>
      {atual.id === 'config' ? <Configuracoes omni={omni} api={api} /> : <Paineis omni={omni} api={api} conta={conta} aba={atual.id} irPara={setAba} />}
    </main>
  );
}
