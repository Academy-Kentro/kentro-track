import { useEffect, useMemo, useState } from 'preact/hooks';
import { Api, criarApi, ErroTrack, lerConfigInstalacao, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Vazio } from '../../comum/componentes';
import { Icone, NomeIcone } from '../../comum/icones';
import type { CtxOmni, Omni } from '../../comum/omni';
import { Analises, DadosAnalises } from './analises';
import { Campanhas } from './campanhas';
import { Configuracoes } from './configuracoes';
import { Criativos } from './criativos';
import { BarraFiltros, consulta, Filtro, PRESETS, useDados } from './filtro';
import { DadosEquipe, DadosLeads, Equipe, FiltroLeads, Leads } from './leads';
import { CHAVES_PENDENTES, PrimeiroUso } from './primeiro-uso';
import type { Campanhas as DadosCampanhas, Conta, Criativos as DadosCriativos, Filtros, VisaoGeral as DadosVisao } from './tipos';
import { VisaoGeral } from './visao-geral';

type Estado = { tipo: 'carregando' } | { tipo: 'sem_chave' } | { tipo: 'erro'; mensagem: string; chaveInvalida: boolean } | { tipo: 'ok'; conta: Conta };

const ABAS: readonly { id: string; titulo: string; icone: NomeIcone; soAdmin?: true }[] = [
  { id: 'visao', titulo: 'Visão geral', icone: 'grafico' },
  { id: 'analises', titulo: 'Análises', icone: 'funil' },
  { id: 'campanhas', titulo: 'Campanhas', icone: 'megafone' },
  { id: 'criativos', titulo: 'Criativos', icone: 'imagem' },
  { id: 'leads', titulo: 'Leads', icone: 'lista' },
  { id: 'equipe', titulo: 'Equipe', icone: 'usuarios' },
  { id: 'config', titulo: 'Configurações', icone: 'ajustes', soAdmin: true },
] as const;

type IdAba = 'visao' | 'analises' | 'campanhas' | 'criativos' | 'leads' | 'equipe' | 'config';

const PAPEL: Record<Conta['papel'], string> = { admin: 'Administrador', gestor: 'Gestor', atendimento: 'Atendimento' };
const FILTRO_SALVO = 'filtro';
const FILTRO_PADRAO: Filtro = { preset: 'ultimos30', contaAnuncio: '', campanha: '' };
/** Enquanto os 90 dias chegam, as abas se atualizam sozinhas. */
const ATUALIZAR_NA_CARGA_MS = 30_000;

function Paineis({ omni, api, conta, aba, irPara }: { omni: Omni; api: Api; conta: Conta; aba: IdAba; irPara: (a: IdAba) => void }) {
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_PADRAO);
  const [filtroLeads, setFiltroLeads] = useState<FiltroLeads>({ origem: '', etapa: '', pagina: 1 });

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
    setFiltroLeads((l) => ({ ...l, pagina: 1 }));
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
  const analises = useDados<DadosAnalises>(api, pronto && aba === 'analises' ? `/v1/painel/analises?${q}` : null, intervalo);
  const campanhas = useDados<DadosCampanhas>(api, pronto && aba === 'campanhas' ? `/v1/painel/campanhas?${q}` : null, intervalo);
  const criativos = useDados<DadosCriativos>(api, pronto && aba === 'criativos' ? `/v1/painel/criativos?${q}` : null, intervalo);
  const qLeads = new URLSearchParams(q);
  if (filtroLeads.origem) qLeads.set('origem', filtroLeads.origem);
  if (filtroLeads.etapa) qLeads.set('etapa', filtroLeads.etapa);
  if (filtroLeads.pagina > 1) qLeads.set('pagina', String(filtroLeads.pagina));
  const leads = useDados<DadosLeads>(api, pronto && aba === 'leads' ? `/v1/painel/leads?${qLeads}` : null);
  const equipe = useDados<DadosEquipe>(api, pronto && aba === 'equipe' ? `/v1/painel/equipe?${q}` : null);

  if (!opcoes.dados) return opcoes.erro ? <Aviso tipo="erro">{opcoes.erro}</Aviso> : <Carregando />;
  if (!pronto) {
    return (
      <section class="kt-card">
        <Vazio icone="tomada" titulo="Nenhuma conta de anúncio selecionada">
          {conta.papel === 'admin' ? (
            <>
              <p>Conecte o Business Manager do cliente e marque as contas de anúncio que entram nos painéis.</p>
              <button type="button" class="kt-botao" onClick={() => irPara('config')}>
                <Icone nome="tomada" tamanho={15} />
                Conecte o Meta e marque as contas em Configurações
              </button>
            </>
          ) : (
            <p>Nenhuma conta de anúncio conectada ainda. Peça ao administrador para conectar o Meta no Kentro Track.</p>
          )}
        </Vazio>
      </section>
    );
  }

  return (
    <>
      <BarraFiltros filtro={valido} opcoes={opcoes.dados} mudar={mudar} />
      {aba === 'visao' && <VisaoGeral carga={visao} />}
      {aba === 'analises' && <Analises carga={analises} />}
      {aba === 'campanhas' && <Campanhas carga={campanhas} />}
      {aba === 'criativos' && <Criativos carga={criativos} />}
      {aba === 'leads' && <Leads omni={omni} api={api} carga={leads} filtro={filtroLeads} mudar={setFiltroLeads} />}
      {aba === 'equipe' && <Equipe omni={omni} api={api} carga={equipe} />}
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

  if (estado.tipo === 'carregando') {
    return (
      <main class="kt-gestao">
        <Carregando />
      </main>
    );
  }
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

  const abas = ABAS.filter((a) => !a.soAdmin || conta.papel === 'admin');
  const atual = abas.find((a) => a.id === aba) ?? abas[0];
  return (
    <main class="kt-gestao">
      <header class="kt-topo">
        <span class="kt-marca" aria-hidden="true">
          <Icone nome="grafico" tamanho={20} />
        </span>
        <div class="kt-topo-titulos">
          <h1>Kentro Track</h1>
          <p class="kt-muted">
            {conta.nome ?? 'Conta sem nome'} · {PAPEL[conta.papel]}
          </p>
        </div>
        <div class="kt-topo-estado">
          {conta.status === 'ativa' && (
            <span class="kt-selo kt-selo-ok">
              <span class="kt-ponto" />
              Meta conectado
            </span>
          )}
          {conta.status === 'pendente_conexao' && (
            <span class="kt-selo kt-selo-neutro">
              <span class="kt-ponto" />
              Meta não conectado
            </span>
          )}
          {conta.status === 'reconectar' && (
            <span class="kt-selo kt-selo-erro">
              <span class="kt-ponto" />
              Reconectar o Meta
            </span>
          )}
        </div>
      </header>
      <nav class="kt-abas" role="tablist">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === atual.id} class="kt-aba" onClick={() => setAba(a.id as IdAba)}>
            <Icone nome={a.icone} tamanho={16} />
            {a.titulo}
          </button>
        ))}
      </nav>
      {atual.id === 'config' ? <Configuracoes omni={omni} api={api} /> : <Paineis omni={omni} api={api} conta={conta} aba={atual.id as IdAba} irPara={setAba} />}
    </main>
  );
}
