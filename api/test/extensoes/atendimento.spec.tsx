/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["require", "default"]}
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../../../extension/atendimento/src/app';
import type { CtxOmni } from '../../../extension/comum/omni';
import { aguardar, erro, ok, omniFalso, OpcoesFalso } from './omni-falso';

const CTX: CtxOmni = {
  config: { api_url: 'https://track.teste/', chave_atendimento: ' ktk_123 ' },
  user: { id: 5, name: 'Ana Lúcia' },
  instance: { domain: 'cliente.atenderbem.com' },
};
const CONTA = { id: 'c1', nome: 'Empresa', papel: 'atendimento' };

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
  const falso = omniFalso({ http: () => ok(CONTA), ...opcoes });
  await act(async () => {
    render(<App omni={falso.omni} ctx={ctx} />, raiz);
  });
  await act(() => aguardar());
  return falso;
}

describe('painel do atendimento', () => {
  it('mostra o anúncio que trouxe o lead', async () => {
    await montar({
      chat: { id: 10, channel: 'whatsapp' },
      mensagens: [
        { id: 2, text: 'quero saber o preço' },
        { id: 1, text: 'Olá!', ad: { headline: 'Promoção de outubro', body: 'Chame no WhatsApp', source_url: 'https://fb.me/abc' } },
      ],
    });
    expect(raiz.textContent).toContain('Veio de um anúncio');
    expect(raiz.textContent).toContain('Promoção de outubro');
    expect(raiz.textContent).toContain('Chame no WhatsApp');
    expect(raiz.textContent).toContain('https://fb.me/abc');
  });

  it('diz quando não achou anúncio', async () => {
    await montar({ chat: { id: 10 }, mensagens: [{ id: 1, text: 'oi' }] });
    expect(raiz.textContent).toContain('Nenhum anúncio identificado nas 1 mensagens');
  });

  it('sem atendimento aberto, orienta a abrir um', async () => {
    await montar({ chat: null });
    expect(raiz.textContent).toContain('Abra um atendimento');
  });

  it('troca de anúncio ao selecionar outro atendimento', async () => {
    const falso = await montar({ chat: null, mensagens: [{ id: 1, ad: { headline: 'Outro anúncio' } }] });
    await act(async () => falso.emitir('omniChatSelected', { id: 11 }));
    await act(() => aguardar());
    expect(raiz.textContent).toContain('Outro anúncio');
  });

  it('confere a conta com a chave limpa e os cabeçalhos de auditoria', async () => {
    const falso = await montar({ chat: null });
    expect(falso.chamadas).toHaveLength(1);
    expect(falso.chamadas[0]).toMatchObject({
      url: 'https://track.teste/v1/conta',
      method: 'GET',
      headers: { 'X-Track-Chave': 'ktk_123', 'X-Kentro-Usuario-Id': '5', 'X-Kentro-Usuario-Nome': 'Ana%20L%C3%BAcia', 'X-Kentro-Instancia': 'cliente.atenderbem.com' },
    });
  });

  it('sem chave, pede a configuração ao administrador e ainda mostra a origem', async () => {
    const falso = await montar(
      { chat: { id: 10 }, mensagens: [{ id: 1, ad: { headline: 'Promo' } }] },
      { ...CTX, config: { api_url: 'https://track.teste' } },
    );
    expect(raiz.textContent).toContain('Peça ao administrador para configurar o Kentro Track');
    expect(raiz.textContent).toContain('Promo');
    expect(falso.chamadas).toHaveLength(0);
  });

  it('recusa a chave de admin no painel do atendente', async () => {
    await montar({ chat: null, http: () => ok({ ...CONTA, papel: 'admin' }) });
    expect(raiz.textContent).toContain('chave de admin');
    expect(raiz.textContent).toContain('chave de atendimento');
  });

  it('mostra a mensagem da API quando a chave é inválida', async () => {
    await montar({ chat: null, http: () => erro(401, 'CHAVE_INVALIDA', 'x') });
    expect(raiz.textContent).toContain('A chave do Kentro Track é inválida');
  });

  it('erro do proxy da Kentro (http_error) vira a mensagem da API', async () => {
    await montar({
      chat: null,
      http: () => {
        throw Object.assign(new Error('falhou'), { code: 'http_error', status: 403, body: JSON.stringify({ erro: { codigo: 'CONTA_BLOQUEADA', mensagem: 'm' } }) });
      },
    });
    expect(raiz.textContent).toContain('Esta conta está bloqueada');
  });
});
