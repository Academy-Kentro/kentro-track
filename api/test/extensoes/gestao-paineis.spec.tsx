/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["require", "default"]}
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mensagemDeErro } from '../../../extension/comum/api';
import { dinheiro, percentual, variacao } from '../../../extension/comum/formato';
import type { CtxOmni } from '../../../extension/comum/omni';
import { App } from '../../../extension/gestao/src/app';
import { periodo } from '../../../extension/gestao/src/filtro';
import { tetoRedondo } from '../../../extension/gestao/src/graficos';
import { assentar, ChamadaHttp, erro, ok, omniFalso, OpcoesFalso } from './omni-falso';

const CONTA = { id: 'c1', nome: 'Empresa X', status: 'ativa', plano: 'gratis', fuso: 'America/Sao_Paulo', moeda: 'BRL', papel: 'admin', loginMetaDisponivel: false };
const FILTROS = {
  contasAnuncio: [{ id: 'ca1', nome: 'Loja Principal', moeda: 'BRL', fuso: 'America/Sao_Paulo' }],
  campanhas: [{ idMeta: '1001', nome: 'Black Friday', contaAnuncioId: 'ca1', ativa: true }],
  cargaPendente: false,
  sincronizadoEm: '2026-10-21T10:00:00.000Z',
};
const metricas = (m: object = {}) => ({
  investimento: 1500,
  impressoes: 100000,
  cliques: 2000,
  cliquesLink: 1500,
  leads: 60,
  conversas: 40,
  ctr: 1.5,
  cpc: 1,
  cpm: 15,
  cpl: 25,
  custoPorConversa: 37.5,
  ...m,
});
const VISAO = {
  moeda: 'BRL',
  periodo: { de: '2026-10-01', ate: '2026-10-03' },
  anterior: { de: '2026-09-28', ate: '2026-09-30', metricas: metricas({ investimento: 1000, leads: 40, cpl: 20 }) },
  metricas: metricas(),
  serie: [
    { data: '2026-10-01', investimento: 500, leads: 20, conversas: 10, impressoes: 1, cliquesLink: 1 },
    { data: '2026-10-02', investimento: 0, leads: 0, conversas: 0, impressoes: 0, cliquesLink: 0 },
    { data: '2026-10-03', investimento: 1000, leads: 40, conversas: 30, impressoes: 1, cliquesLink: 1 },
  ],
  contasAnuncio: 1,
  cargaPendente: false,
  sincronizadoEm: '2026-10-21T10:00:00.000Z',
};
const no = (idMeta: string, nome: string, m: object) => ({ idMeta, nome, status: 'ACTIVE', metricas: metricas(m) });
const CAMPANHAS = {
  moeda: 'BRL',
  cargaPendente: false,
  sincronizadoEm: null,
  campanhas: [
    { ...no('1001', 'Black Friday', { investimento: 1000 }), conjuntos: [{ ...no('2001', 'Público quente', {}), anuncios: [no('3001', 'Vídeo depoimento', {})] }] },
    { ...no('1002', 'Remarketing', { investimento: 500, cpl: null }), conjuntos: [] },
  ],
};

function api(rotas: Record<string, unknown>) {
  return (c: ChamadaHttp) => {
    const caminho = new URL(c.url).pathname;
    if (caminho in rotas) return ok(rotas[caminho]);
    return erro(404, 'NAO_ENCONTRADO', caminho);
  };
}

const CTX: CtxOmni = { config: { api_url: 'https://track.teste', chave: 'kta_A' }, user: { id: 1, name: 'Admin' }, instance: { name: 'X' } };

let raiz: HTMLElement;
beforeEach(() => {
  raiz = document.createElement('div');
  document.body.appendChild(raiz);
});
afterEach(() => {
  render(null, raiz);
  raiz.remove();
});

async function montar(opcoes: OpcoesFalso) {
  const falso = omniFalso(opcoes);
  await act(async () => {
    render(<App omni={falso.omni} ctx={CTX} />, raiz);
  });
  await assentar(act);
  return falso;
}

const botao = (texto: string) => [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(texto));
async function clicar(alvo: Element | undefined) {
  await act(async () => {
    (alvo as HTMLElement).click();
  });
  await assentar(act);
}
const texto = () => raiz.textContent?.replace(/\s+/g, ' ') ?? '';

describe('gestão: visão geral', () => {
  it('mostra os indicadores com a variação na direção certa e os dois gráficos', async () => {
    const falso = await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': VISAO }) });
    const visao = falso.chamadas.find((c) => c.url.includes('/visao-geral'))!;
    expect(new URL(visao.url).searchParams.get('de')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(texto()).toContain(dinheiro(1500).replace(/\s/g, ' '));
    expect(texto()).toContain('Custo por lead');
    // Leads subiu 50% (bom); CPL subiu 25% (ruim): a cor vem da direção × o que é melhor.
    const deltas = [...raiz.querySelectorAll('.kt-indicador')].map((el) => [el.querySelector('.kt-indicador-rotulo')!.textContent, el.querySelector('.kt-delta')!.className]);
    expect(deltas).toEqual(expect.arrayContaining([['Leads', 'kt-delta kt-delta-bom'], ['Custo por lead', 'kt-delta kt-delta-ruim']]));
    // A seta é ícone; o texto da variação vem junto (direção nunca só pela cor).
    const leads = [...raiz.querySelectorAll('.kt-indicador')].find((el) => el.querySelector('.kt-indicador-rotulo')!.textContent === 'Leads')!;
    expect(leads.querySelector('.kt-delta')!.textContent).toBe('+50%');
    expect(leads.querySelector('.kt-delta svg')).not.toBeNull();

    const graficos = raiz.querySelectorAll('figure.kt-grafico');
    expect([...graficos].map((g) => g.querySelector('h3')!.textContent)).toEqual(['Investimento por dia', 'Leads por dia']);
    // Dia sem entrega não desenha coluna, mas continua com alvo de foco (3 dias, 2 colunas).
    expect(graficos[0].querySelectorAll('path.kt-coluna')).toHaveLength(2);
    expect(graficos[0].querySelectorAll('rect.kt-alvo')).toHaveLength(3);
  });

  it('a dica mostra o valor do dia com foco no teclado, e a tabela substitui o gráfico', async () => {
    await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': VISAO }) });
    const alvo = raiz.querySelectorAll('figure.kt-grafico')[0].querySelectorAll('rect.kt-alvo')[2];
    await act(async () => {
      alvo.dispatchEvent(new FocusEvent('focus'));
    });
    expect(raiz.querySelector('.kt-dica')?.textContent).toContain('03/10/2026');

    await clicar(botao('Ver tabela'));
    expect(raiz.querySelector('figure.kt-grafico table')?.textContent).toContain('01/10/2026');
  });

  it('sem conta de anúncio selecionada, o admin é levado para Configurações', async () => {
    await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': { ...FILTROS, contasAnuncio: [], campanhas: [] }, '/v1/meta/conexao': { conectado: false, loginMetaDisponivel: false, contasAnuncio: [] } }) });
    expect(texto()).toContain('Nenhuma conta de anúncio selecionada');
    await clicar(botao('Conecte o Meta'));
    expect(texto()).toContain('Token de usuário do sistema');
  });

  it('o gestor sem contas recebe o recado para o administrador', async () => {
    await montar({ http: api({ '/v1/conta': { ...CONTA, papel: 'gestor' }, '/v1/painel/filtros': { ...FILTROS, contasAnuncio: [] } }) });
    expect(texto()).toContain('Peça ao administrador para conectar o Meta');
  });

  it('durante a carga dos 90 dias, avisa que os números estão chegando', async () => {
    await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': { ...FILTROS, cargaPendente: true }, '/v1/painel/visao-geral': { ...VISAO, cargaPendente: true } }) });
    expect(texto()).toContain('Carregando os últimos 90 dias do Meta');
  });

  it('mudar o período refaz a consulta e guarda o filtro do usuário', async () => {
    const falso = await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': VISAO }) });
    const select = raiz.querySelector('.kt-filtros select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'ultimos7';
      select.dispatchEvent(new Event('change'));
    });
    await assentar(act);
    const ultima = falso.chamadas.filter((c) => c.url.includes('/visao-geral')).at(-1)!;
    expect(new URL(ultima.url).searchParams.get('de')).toBe(periodo('ultimos7').de);
    expect(falso.armazenamento.get('filtro')).toMatchObject({ preset: 'ultimos7' });
  });
});

describe('gestão: campanhas e criativos', () => {
  it('a tabela abre campanha › conjunto › anúncio e reordena pela coluna', async () => {
    await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/campanhas': CAMPANHAS }) });
    await clicar(botao('Campanhas'));
    const nomes = () => [...raiz.querySelectorAll('tbody .kt-nome')].map((n) => n.textContent);
    expect(nomes()).toEqual(['Black Friday', 'Remarketing']);
    expect(texto()).toContain('—'); // CPL sem leads

    await clicar(raiz.querySelector('tbody .kt-abrir') as Element);
    await clicar(raiz.querySelectorAll('tbody .kt-abrir')[1]);
    expect(nomes()).toEqual(['Black Friday', 'Público quente', 'Vídeo depoimento', 'Remarketing']);

    await clicar(botao('Investimento'));
    expect(nomes()[0]).toBe('Remarketing');
  });

  it('criativos mostram miniatura e caem nas iniciais quando a imagem falha', async () => {
    await montar({
      http: api({
        '/v1/conta': CONTA,
        '/v1/painel/filtros': FILTROS,
        '/v1/painel/criativos': {
          moeda: 'BRL',
          cargaPendente: false,
          sincronizadoEm: null,
          criativos: [{ ...no('3001', 'Vídeo depoimento', {}), campanha: 'Black Friday', titulo: 'Promo', texto: null, miniatura: 'https://track.teste/m/x.y' }],
        },
      }),
    });
    await clicar(botao('Criativos'));
    const img = raiz.querySelector('img.kt-miniatura') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://track.teste/m/x.y');
    await act(async () => {
      img.dispatchEvent(new Event('error'));
    });
    expect(raiz.querySelector('.kt-miniatura-vazia')?.textContent).toBe('VD');
    expect(texto()).toContain('“Promo”');
  });
});

describe('gestão: conexão com o Meta', () => {
  const CONECTADO = {
    conectado: true,
    loginMetaDisponivel: false,
    tipo: 'token_manual',
    status: 'ativa',
    usuarioMeta: 'Sistema',
    escopos: ['ads_read'],
    verificadoEm: new Date().toISOString(),
    ultimoErro: null,
    contasAnuncio: [
      {
        id: 'ca1',
        idMeta: 'act_111',
        nome: 'Loja Principal',
        moeda: 'BRL',
        fuso: 'America/Sao_Paulo',
        empresa: 'Grupo PK',
        ativaNoMeta: true,
        selecionada: false,
        definicaoLead: ['formulario', 'conversa'],
        sincronizacao: { cargaConcluidaEm: null, ultimaEm: null, ultimoErro: null, emAndamento: false },
      },
    ],
  };

  it('conecta com o token sem espaços, marca a conta, ajusta o que conta como lead e salva', async () => {
    let estado: object = { conectado: false, loginMetaDisponivel: false, contasAnuncio: [] };
    const falso = await montar({
      http: (c) => {
        const caminho = new URL(c.url).pathname;
        if (caminho === '/v1/conta') return ok(CONTA);
        if (caminho === '/v1/painel/filtros') return ok({ ...FILTROS, contasAnuncio: [] });
        if (caminho === '/v1/meta/token-manual') return ok((estado = { ...CONECTADO, avisos: [] }));
        if (caminho === '/v1/meta/contas-anuncio') return ok(estado);
        return ok(estado);
      },
    });
    await clicar(botao('Configurações'));
    const area = raiz.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      area.value = ' EAAG123456789012345678901234\n';
      area.dispatchEvent(new Event('input'));
    });
    await clicar(botao('Conectar'));
    expect(falso.chamadas.find((c) => c.url.endsWith('/v1/meta/token-manual'))).toMatchObject({ method: 'PUT', corpo: { token: 'EAAG123456789012345678901234' } });
    expect(texto()).toContain('como Sistema');
    expect(texto()).toContain('Loja Principal');

    const marcar = raiz.querySelector('.kt-contas-anuncio input[type=checkbox]') as HTMLInputElement;
    await act(async () => {
      marcar.click();
    });
    const site = [...raiz.querySelectorAll('.kt-definicao label')].find((l) => l.textContent?.includes('pixel'))!.querySelector('input')!;
    await act(async () => {
      site.click();
    });
    await clicar(botao('Salvar'));
    expect(falso.chamadas.find((c) => c.url.endsWith('/v1/meta/contas-anuncio'))).toMatchObject({
      method: 'PUT',
      corpo: { contas: [{ id: 'ca1', selecionada: true, definicaoLead: ['formulario', 'conversa', 'site'] }] },
    });
  });

  it('token caído: pede um novo e esconde a lista de contas', async () => {
    await montar({
      http: api({ '/v1/conta': { ...CONTA, status: 'reconectar' }, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': VISAO, '/v1/meta/conexao': { ...CONECTADO, status: 'reconectar', ultimoErro: 'Session has expired' } }),
    });
    expect(texto()).toContain('Reconectar o Meta');
    await clicar(botao('Configurações'));
    expect(texto()).toContain('O Meta deixou de aceitar o token (Session has expired)');
    expect(raiz.querySelector('textarea')).not.toBeNull();
    expect(raiz.querySelector('.kt-contas-anuncio')).toBeNull();
  });
});

describe('mensagens de erro da extensão', () => {
  it('mostra a mensagem da API também nos 5xx (ex.: motivo do Meta) e o código quando a falha é na Kentro', () => {
    expect(mensagemDeErro({ status: 502, codigo: 'META_INDISPONIVEL', mensagem: 'Não foi possível falar com o Meta agora: x' })).toBe('Não foi possível falar com o Meta agora: x');
    expect(mensagemDeErro({ status: 0, codigo: 'bad_args', mensagem: '' })).toBe('Não foi possível falar com o Kentro Track agora. Tente de novo em instantes. (código: bad_args)');
    expect(mensagemDeErro({ status: 0, codigo: 'timeout', mensagem: '' })).toContain('demorou demais');
    expect(mensagemDeErro({ status: 503, codigo: '', mensagem: '' })).toContain('(código: HTTP 503)');
  });
});

describe('formatos e utilidades', () => {
  it('dinheiro, percentual e traço para ausente', () => {
    expect(dinheiro(1234.5)).toBe('R$ 1.234,50'.replace(' ', ' '));
    expect(dinheiro(null)).toBe('—');
    expect(percentual(1.625)).toBe('1,63%');
  });

  it('variação: cor pela direção e pelo que é melhor; sem base, nada', () => {
    expect(variacao(30, 20, false)).toMatchObject({ direcao: 'sobe', bom: false, texto: '+50%' });
    expect(variacao(10, 20, true)).toMatchObject({ direcao: 'desce', bom: false, texto: '-50%' });
    expect(variacao(10, 0, true)).toBeNull();
    expect(variacao(null, 5, true)).toBeNull();
    expect(variacao(100.2, 100, true)).toMatchObject({ direcao: 'estavel', bom: null });
  });

  it('teto do eixo em número redondo', () => {
    expect([0, 7, 13, 240, 999, 1001].map(tetoRedondo)).toEqual([1, 10, 20, 250, 1000, 2000]);
  });

  it('períodos no relógio de quem vê', () => {
    const hoje = new Date(2026, 9, 21);
    expect(periodo('ultimos7', hoje)).toEqual({ de: '2026-10-15', ate: '2026-10-21' });
    expect(periodo('ultimos30', hoje)).toEqual({ de: '2026-09-22', ate: '2026-10-21' });
    expect(periodo('mes', hoje)).toEqual({ de: '2026-10-01', ate: '2026-10-21' });
    expect(periodo('mesPassado', hoje)).toEqual({ de: '2026-09-01', ate: '2026-09-30' });
    expect(periodo('mesPassado', new Date(2026, 0, 10))).toEqual({ de: '2025-12-01', ate: '2025-12-31' });
  });
});

describe('gestão: funil do atendimento, leads, equipe e integração', () => {
  const COM_FUNIL = { ...VISAO, organicos: 3, metricas: metricas({ entradas: 40, qualificados: 20, vendas: 8, receita: 6000, roas: 4, custoPorVenda: 187.5, taxaVenda: 20 }) };
  const LEADS = {
    pagina: 1,
    temMais: true,
    porEtapa: { venda: 1, novo: 1 },
    itens: [
      { id: 'l1', origem: 'ctwa', etapa: 'venda', nome: 'Maria', telefone: '(38) 9****-0000', chatId: '501', recebidoEm: '2026-10-10T16:00:00Z', atendente: 'Ana', valorVenda: 3000, campanha: 'Black Friday', anuncio: 'Vídeo', vinculoAproximado: true },
      { id: 'l2', origem: 'organico', etapa: 'novo', nome: null, telefone: null, chatId: null, recebidoEm: '2026-10-11T16:00:00Z', atendente: null, valorVenda: null, campanha: null, anuncio: null, vinculoAproximado: false },
    ],
  };

  it('visão geral mostra receita, ROAS e o funil do anúncio à venda', async () => {
    await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': COM_FUNIL }) });
    expect(texto()).toContain('No atendimento');
    expect(texto()).toContain('4,00x');
    expect(texto()).toContain('Mais 3 atendimentos sem anúncio');
    const funil = [...raiz.querySelectorAll('.kt-funil-tabela tr')].map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim());
    // Leads do Meta 60 → 40 no atendimento (67%) → 20 (50%) → 8 (40%)
    expect(funil).toEqual(['Leads no Meta60', 'Chegaram ao atendimento4067%', 'Qualificados2050%', 'Vendas840%']);
  });

  it('sem leads no atendimento, explica como ligar a integração em vez de mostrar zeros', async () => {
    await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': { ...VISAO, organicos: 0, metricas: metricas({ entradas: 0 }) } }) });
    expect(texto()).toContain('Nenhum lead de anúncio chegou ao atendimento');
    expect(raiz.querySelector('.kt-funil')).toBeNull();
  });

  it('aba Leads: filtra por etapa, pagina e abre a conversa na Kentro', async () => {
    const falso = await montar({ http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/leads': LEADS }) });
    await clicar(botao('Leads'));
    expect(texto()).toContain('Maria · (38) 9****-0000');
    expect(texto()).toContain('Black Friday › Vídeo *');
    await clicar(botao('Vendas ('));
    expect(new URL(falso.chamadas.at(-1)!.url).searchParams.get('etapa')).toBe('venda');
    await clicar(botao('Próximos'));
    expect(new URL(falso.chamadas.at(-1)!.url).searchParams.get('pagina')).toBe('2');
    await clicar(botao('Abrir conversa'));
    expect(falso.selecionados).toEqual([501]);
  });

  it('aba Equipe: por atendente', async () => {
    await montar({
      http: api({
        '/v1/conta': CONTA,
        '/v1/painel/filtros': FILTROS,
        '/v1/painel/equipe': { moeda: 'BRL', atendentes: [{ id: '7', nome: 'Ana', entradas: 10, qualificados: 5, vendas: 2, descartados: 3, receita: 4000, taxaVenda: 20, minutosAteAtender: 95 }] },
      }),
    });
    await clicar(botao('Equipe'));
    const linha = raiz.querySelector('tbody tr')!.textContent!.replace(/\s+/g, ' ');
    expect(linha).toContain('Ana');
    expect(linha).toContain('20,0%');
    expect(linha).toContain('1,6 h');
  });

  it('Configurações mostra a URL da integração com os corpos de exemplo', async () => {
    const integracao = {
      url: 'https://track.teste/v1/kentro/eventos/c1.ASSINATURA',
      exemplos: { chat_iniciado: { evento: 'chat_iniciado', chatId: '{{chat_id}}' }, qualificado: {}, venda: {}, descartado: {} },
    };
    await montar({
      http: api({ '/v1/conta': CONTA, '/v1/painel/filtros': FILTROS, '/v1/painel/visao-geral': VISAO, '/v1/meta/conexao': { conectado: false, loginMetaDisponivel: false, contasAnuncio: [] }, '/v1/kentro/integracao': integracao }),
    });
    await clicar(botao('Configurações'));
    expect(texto()).toContain('Integração com o atendimento');
    expect(texto()).toContain('https://track.teste/v1/kentro/eventos/c1.ASSINATURA');
    expect(texto()).toContain('"evento": "chat_iniciado"');
  });
});

describe('gestão: eventos para o Meta', () => {
  const CONFIG = {
    ativo: false,
    datasetId: null,
    datasetNome: null,
    tokenProprio: false,
    wabaId: null,
    codigoTeste: null,
    mapeamento: { lead_recebido: 'Lead', qualificado: 'QualifiedLead', venda: 'Purchase', descartado: null },
  };
  const ENVIOS = {
    ultimos30Dias: { enviado: 12, erro: 1 },
    envios: [{ id: '9', gatilho: 'venda', evento: 'Purchase', status: 'erro', teste: false, tentativas: 2, erro: 'Invalid parameter', lead: 'Maria', criadoEm: '2026-10-23T12:00:00Z', enviadoEm: null }],
  };

  async function abrir(extra: (c: ChamadaHttp) => unknown = () => undefined) {
    const falso = await montar({
      http: (c) => {
        const caminho = new URL(c.url).pathname;
        const r = extra(c);
        if (r !== undefined) return ok(r);
        const rotas: Record<string, unknown> = {
          '/v1/conta': CONTA,
          '/v1/painel/filtros': FILTROS,
          '/v1/painel/visao-geral': VISAO,
          '/v1/meta/conexao': { conectado: false, loginMetaDisponivel: false, contasAnuncio: [] },
          '/v1/kentro/integracao': { url: 'https://x', exemplos: { chat_iniciado: {}, qualificado: {}, venda: {}, descartado: {} } },
          '/v1/eventos/configuracao': CONFIG,
          '/v1/eventos/envios': ENVIOS,
          '/v1/eventos/pixels': { pixels: [{ id: '555666777', nome: 'Pixel Loja', ultimoDisparo: '2026-10-22T10:00:00+0000', contaAnuncio: 'Loja Principal' }] },
          '/v1/eventos/testar': { ok: true, eventosRecebidos: 1, evento: 'Lead' },
          '/v1/eventos/envios/9/reenviar': { ...ENVIOS, envios: [{ ...ENVIOS.envios[0], status: 'pendente' }] },
        };
        return caminho in rotas ? ok(rotas[caminho]) : erro(404, 'NAO_ENCONTRADO', caminho);
      },
    });
    await clicar(botao('Configurações'));
    return falso;
  }

  it('escolhe o pixel da lista, liga o envio, muda o evento da venda e salva só o que mudou', async () => {
    const falso = await abrir();
    expect(texto()).toContain('desligue a outra no mesmo dia');
    await clicar(botao('Buscar pixels'));
    await clicar(botao('Pixel Loja'));
    const ativo = [...raiz.querySelectorAll('.kt-interruptor input')][0] as HTMLInputElement;
    await act(async () => {
      ativo.click();
    });
    const venda = [...raiz.querySelectorAll('.kt-mapeamento tr')].find((tr) => tr.textContent?.startsWith('Venda'))!.querySelector('select')!;
    await act(async () => {
      venda.value = 'CompleteRegistration';
      venda.dispatchEvent(new Event('change'));
    });
    await clicar(botao('Salvar'));
    const put = falso.chamadas.find((c) => c.method === 'PUT' && c.url.endsWith('/v1/eventos/configuracao'))!;
    expect(put.corpo).toEqual({
      datasetId: '555666777',
      datasetNome: 'Pixel Loja',
      ativo: true,
      mapeamento: { lead_recebido: 'Lead', qualificado: 'QualifiedLead', venda: 'CompleteRegistration', descartado: null },
    });
  });

  it('evento de teste com o código digitado', async () => {
    const falso = await abrir((c) => (c.url.endsWith('/v1/eventos/configuracao') && c.method === 'GET' ? { ...CONFIG, datasetId: '555666777' } : undefined));
    const campo = [...raiz.querySelectorAll('.kt-campo')].find((l) => l.textContent?.includes('Código de teste'))!.querySelector('input')!;
    await act(async () => {
      campo.value = 'TEST77';
      campo.dispatchEvent(new Event('input'));
    });
    await clicar(botao('Enviar evento de teste'));
    expect(falso.chamadas.find((c) => c.url.endsWith('/v1/eventos/testar'))?.corpo).toEqual({ codigoTeste: 'TEST77' });
  });

  it('lista os últimos envios e reenvia o que deu erro', async () => {
    const falso = await abrir();
    expect(texto()).toContain('12 recebidos');
    expect(texto()).toContain('Invalid parameter');
    await clicar(botao('Reenviar'));
    expect(falso.chamadas.some((c) => c.method === 'POST' && c.url.endsWith('/v1/eventos/envios/9/reenviar'))).toBe(true);
    expect(texto()).toContain('Na fila');
  });
});
