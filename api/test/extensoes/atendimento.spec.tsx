/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["require", "default"]}
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../../../extension/atendimento/src/app';
import { niveis, type LeadPainel } from '../../../extension/atendimento/src/lead';
import type { CtxOmni } from '../../../extension/comum/omni';
import { assentar, ChamadaHttp, erro, ok, omniFalso, OpcoesFalso } from './omni-falso';

const CTX: CtxOmni = {
  config: { api_url: 'https://track.teste/', chave_atendimento: ' ktk_123 ' },
  user: { id: 5, name: 'Ana Lúcia' },
  instance: { domain: 'cliente.atenderbem.com' },
};
const CONTA = { id: 'c1', nome: 'Empresa', papel: 'atendimento' };

const LEAD: LeadPainel = {
  id: 'l1',
  origem: 'ctwa',
  etapa: 'em_atendimento',
  nome: 'Maria',
  recebidoEm: new Date().toISOString(),
  valorVenda: null,
  motivoDescarte: null,
  respostas: [],
  anuncio: {
    vinculo: 'texto',
    campanha: { idMeta: '100', nome: 'Black Friday' },
    conjunto: { idMeta: '200', nome: 'Público quente' },
    anuncio: { idMeta: '300', nome: 'Vídeo depoimento', titulo: 'Promoção de outubro', texto: 'Chame no WhatsApp', miniatura: 'https://track.teste/m/x.y' },
    titulo: 'Promoção de outubro',
    texto: 'Chame no WhatsApp',
    url: null,
  },
  historico: [{ tipo: 'recebido', texto: 'Chegou por um anúncio.', autor: 'atendente', em: new Date().toISOString() }],
  outrasEntradas: [{ id: 'l0', origem: 'ctwa', etapa: 'venda', recebidoEm: '2026-09-01T12:00:00Z', campanha: 'Inverno', valorVenda: 800 }],
};

/** API falsa: conta, vincular e etapa (a etapa devolve o lead com o que foi pedido). */
function api(c: ChamadaHttp) {
  const caminho = new URL(c.url).pathname;
  if (caminho === '/v1/conta') return ok(CONTA);
  if (caminho === '/v1/atendimento/vincular') return ok(LEAD);
  if (caminho === '/v1/atendimento/leads/l1/etapa') {
    const corpo = c.corpo as { etapa: LeadPainel['etapa']; valor?: number; motivo?: string };
    return ok({ ...LEAD, etapa: corpo.etapa, valorVenda: corpo.valor ?? null, motivoDescarte: corpo.motivo ?? null });
  }
  return erro(404, 'NAO_ENCONTRADO', caminho);
}

let raiz: HTMLElement;
beforeEach(() => {
  raiz = document.createElement('div');
  document.body.appendChild(raiz);
});
afterEach(() => {
  render(null, raiz);
  raiz.remove();
});

async function montar(opcoes: OpcoesFalso, ctx: CtxOmni = CTX) {
  const falso = omniFalso({ http: api, ...opcoes });
  await act(async () => {
    render(<App omni={falso.omni} ctx={ctx} />, raiz);
  });
  await assentar(act);
  return falso;
}

const texto = () => raiz.textContent?.replace(/\s+/g, ' ') ?? '';
const botao = (t: string) => [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim() === t)!;
async function clicar(b: Element) {
  await act(async () => {
    (b as HTMLElement).click();
  });
  await assentar(act, 3);
}

describe('painel do atendimento', () => {
  const CONVERSA = {
    chat: { id: 10, contactId: 77, contact: { name: 'Maria', phone: '5538999990000' } },
    mensagens: [
      { id: 2, text: 'quero saber o preço' },
      { id: 1, text: 'Olá!', ad: { source_id: '300', headline: 'Promoção de outubro', body: 'Chame no WhatsApp', source_url: 'https://fb.me/abc' } },
    ],
  };

  it('liga a conversa ao lead mandando o resumo do anúncio, o contato e os cabeçalhos de auditoria', async () => {
    const falso = await montar(CONVERSA);
    const vincular = falso.chamadas.find((c) => c.url.endsWith('/v1/atendimento/vincular'))!;
    expect(vincular).toMatchObject({
      method: 'POST',
      headers: { 'X-Track-Chave': 'ktk_123', 'X-Kentro-Usuario-Id': '5', 'X-Kentro-Usuario-Nome': 'Ana%20L%C3%BAcia' },
      corpo: {
        chatId: '10',
        telefone: '5538999990000',
        nome: 'Maria',
        contatoId: '77',
        anuncio: { idAnuncio: '300', titulo: 'Promoção de outubro', texto: 'Chame no WhatsApp', url: 'https://fb.me/abc' },
      },
    });
    // Duas chamadas: a conta e o vínculo (o limite é 30 por minuto).
    expect(falso.chamadas).toHaveLength(2);
  });

  it('mostra a origem: campanha, conjunto e anúncio com rótulo, o texto, o aviso de ligação aproximada e outras entradas', async () => {
    await montar(CONVERSA);
    expect(texto()).toContain('Veio de um anúncio');
    const trilha = [...raiz.querySelectorAll('.kt-trilha dl > div')].map((d) => d.textContent);
    expect(trilha).toEqual(['Campanha: Black Friday', 'Conjunto: Público quente', 'Anúncio: Vídeo depoimento']);
    expect(texto()).toContain('Chame no WhatsApp');
    expect(texto()).toContain('identificado pelo texto');
    expect(raiz.querySelector('img.kt-anuncio-imagem')?.getAttribute('src')).toBe('https://track.teste/m/x.y');
    expect(texto()).toContain('Outras vezes que este contato chegou');
    expect(texto()).toContain('Inverno');
  });

  it('níveis com o mesmo nome viram uma linha só', () => {
    const nome = '[WT- CE]21-10[ HNM9C51] Hyundai I30 2.0 - 2010';
    expect(niveis([['Campanha', nome], ['Conjunto', nome], ['Anúncio', nome]])).toEqual([{ rotulo: 'Campanha, conjunto e anúncio', nome }]);
    expect(niveis([['Campanha', 'Feirão'], ['Conjunto', nome], ['Anúncio', nome]])).toEqual([
      { rotulo: 'Campanha', nome: 'Feirão' },
      { rotulo: 'Conjunto e anúncio', nome },
    ]);
    expect(niveis([['Campanha', 'Feirão'], ['Conjunto', null], ['Anúncio', 'Vídeo']])).toEqual([
      { rotulo: 'Campanha', nome: 'Feirão' },
      { rotulo: 'Anúncio', nome: 'Vídeo' },
    ]);
  });

  it('registra a venda com o valor digitado em reais', async () => {
    const falso = await montar(CONVERSA);
    await clicar(botao('Venda'));
    const campo = raiz.querySelector('.kt-formulario-etapa input') as HTMLInputElement;
    await act(async () => {
      campo.value = '1.234,50';
      campo.dispatchEvent(new Event('input'));
    });
    await clicar(botao('Registrar venda'));
    expect(falso.chamadas.at(-1)).toMatchObject({ url: 'https://track.teste/v1/atendimento/leads/l1/etapa', corpo: { etapa: 'venda', valor: 1234.5 } });
    expect(texto()).toContain('Etapa: Venda');
    expect(falso.toasts).toContain('Lead marcado como venda.');
  });

  it('descarta com o motivo escolhido e permite reabrir', async () => {
    const falso = await montar(CONVERSA);
    await clicar(botao('Descartar'));
    const select = raiz.querySelector('.kt-formulario-etapa select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'Sem orçamento';
      select.dispatchEvent(new Event('change'));
    });
    await clicar(botao('Descartar lead'));
    expect(falso.chamadas.at(-1)?.corpo).toEqual({ etapa: 'descartado', motivo: 'Sem orçamento' });
    expect(texto()).toContain('Descartado · Sem orçamento');
    await clicar(botao('Reabrir'));
    expect(falso.chamadas.at(-1)?.corpo).toEqual({ etapa: 'em_atendimento' });
  });

  it('mostra o que já foi para o pixel do Meta', async () => {
    await montar({
      ...CONVERSA,
      http: (c) =>
        c.url.endsWith('/vincular')
          ? ok({ ...LEAD, eventosMeta: [{ gatilho: 'lead_recebido', evento: 'Lead', status: 'enviado' }, { gatilho: 'qualificado', evento: 'QualifiedLead', status: 'pendente' }] })
          : api(c),
    });
    expect(texto()).toContain('Meta: Lead ✓ · QualifiedLead (na fila)');
  });

  it('sem atendimento aberto, orienta a abrir um', async () => {
    await montar({ chat: null });
    expect(texto()).toContain('Abra um atendimento');
  });

  it('troca de lead ao selecionar outro atendimento', async () => {
    const falso = await montar({ chat: null, mensagens: [{ id: 1, ad: { headline: 'Outro anúncio' } }] });
    await act(async () => falso.emitir('omniChatSelected', { id: 11 }));
    await assentar(act);
    expect(falso.chamadas.find((c) => c.url.endsWith('/vincular'))?.corpo).toMatchObject({ chatId: '11', anuncio: { titulo: 'Outro anúncio' } });
  });

  it('sem chave: pede a configuração e ainda mostra o anúncio da conversa, sem chamar a API', async () => {
    const falso = await montar({ ...CONVERSA }, { ...CTX, config: { api_url: 'https://track.teste' } });
    expect(texto()).toContain('Peça ao administrador para configurar o Kentro Track');
    expect(texto()).toContain('Promoção de outubro');
    expect(falso.chamadas).toHaveLength(0);
  });

  it('recusa a chave de admin no painel do atendente e não liga o lead', async () => {
    const falso = await montar({ ...CONVERSA, http: (c) => (c.url.endsWith('/v1/conta') ? ok({ ...CONTA, papel: 'admin' }) : api(c)) });
    expect(texto()).toContain('chave de admin');
    expect(falso.chamadas.some((c) => c.url.endsWith('/vincular'))).toBe(false);
  });

  it('erro ao ligar o lead: mostra o motivo e ainda o anúncio da conversa', async () => {
    await montar({
      ...CONVERSA,
      http: (c) => (c.url.endsWith('/vincular') ? erro(400, 'CHAT_INVALIDO', 'Id do atendimento inválido.') : api(c)),
    });
    expect(texto()).toContain('Id do atendimento inválido.');
    expect(texto()).toContain('Veio de um anúncio');
  });

  it('chave inválida: mensagem clara', async () => {
    await montar({ chat: null, http: () => erro(401, 'CHAVE_INVALIDA', 'x') });
    expect(texto()).toContain('A chave do Kentro Track é inválida');
  });
});
