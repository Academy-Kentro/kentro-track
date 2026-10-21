/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["require", "default"]}
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../../../extension/gestao/src/app';
import { CHAVES_PENDENTES } from '../../../extension/gestao/src/primeiro-uso';
import type { CtxOmni } from '../../../extension/comum/omni';
import { aguardar, ChamadaHttp, ok, omniFalso, OpcoesFalso } from './omni-falso';

const CHAVES = { contaId: 'c1', chaveAdmin: 'kta_A', chaveGestor: 'ktg_G', chaveAtendimento: 'ktk_K' };
const CONTA = {
  id: 'c1',
  nome: 'Empresa X',
  status: 'pendente_conexao',
  plano: 'gratis',
  fuso: 'America/Sao_Paulo',
  moeda: 'BRL',
  papel: 'admin',
  loginMetaDisponivel: false,
};
const ctx = (chave?: string): CtxOmni => ({
  config: { api_url: 'https://track.teste', ...(chave ? { chave } : {}) },
  user: { id: 1, name: 'Admin' },
  instance: { name: 'Empresa X', domain: 'x.atenderbem.com' },
});

let raiz: HTMLElement;
beforeEach(() => {
  raiz = document.createElement('div');
  document.body.appendChild(raiz);
});
afterEach(() => {
  render(null, raiz);
  raiz.remove();
});

async function montar(contexto: CtxOmni, opcoes: OpcoesFalso = {}) {
  const falso = omniFalso(opcoes);
  await act(async () => {
    render(<App omni={falso.omni} ctx={contexto} />, raiz);
  });
  await act(() => aguardar());
  return falso;
}

const botao = (texto: string) => [...raiz.querySelectorAll('button')].find((b) => b.textContent?.includes(texto))!;

async function clicar(texto: string) {
  await act(async () => {
    botao(texto).click();
  });
  await act(() => aguardar());
}

describe('gestão: primeiro uso', () => {
  it('sem chave, cria a conta com o nome da instância e mostra as três chaves com o passo a passo', async () => {
    const falso = await montar(ctx(), { http: (c: ChamadaHttp) => (c.url.endsWith('/v1/contas/registrar') ? ok(CHAVES, 201) : ok({})) });
    expect((raiz.querySelector('input') as HTMLInputElement).value).toBe('Empresa X');

    await clicar('Criar minha conta');

    expect(falso.chamadas[0]).toMatchObject({ url: 'https://track.teste/v1/contas/registrar', method: 'POST', corpo: { nome: 'Empresa X' } });
    // Sem chave ainda: não manda X-Track-Chave; manda a instância para o limite de registro.
    expect(falso.chamadas[0].headers['X-Track-Chave']).toBeUndefined();
    expect(falso.chamadas[0].headers['X-Kentro-Instancia']).toBe('x.atenderbem.com');
    for (const chave of ['kta_A', 'ktg_G', 'ktk_K']) expect(raiz.textContent).toContain(chave);
    expect(raiz.textContent).toContain('https://track.teste/extensao/atendimento/manifest.json');
    expect(falso.armazenamento.get(CHAVES_PENDENTES)).toEqual(CHAVES);
  });

  it('reabre mostrando as chaves pendentes, sem criar outra conta', async () => {
    const falso = omniFalso();
    falso.armazenamento.set(CHAVES_PENDENTES, CHAVES);
    await act(async () => {
      render(<App omni={falso.omni} ctx={ctx()} />, raiz);
    });
    await act(() => aguardar());
    expect(raiz.textContent).toContain('kta_A');
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe('gestão: conta conectada', () => {
  it('admin vê as abas, inclusive Configurações, e as chaves pendentes são apagadas', async () => {
    const falso = omniFalso({ http: () => ok(CONTA) });
    falso.armazenamento.set(CHAVES_PENDENTES, CHAVES);
    await act(async () => {
      render(<App omni={falso.omni} ctx={ctx('kta_A')} />, raiz);
    });
    await act(() => aguardar());
    expect(raiz.textContent).toContain('Empresa X · Administrador');
    expect(raiz.textContent).toContain('Meta não conectado');
    expect(botao('Configurações')).toBeTruthy();
    expect(falso.armazenamento.has(CHAVES_PENDENTES)).toBe(false);
  });

  it('gestor não vê Configurações', async () => {
    await montar(ctx('ktg_G'), { http: () => ok({ ...CONTA, papel: 'gestor' }) });
    expect(raiz.textContent).toContain('Gestor');
    expect(botao('Configurações')).toBeUndefined();
  });

  it('chave de atendimento colada na Gestão é recusada', async () => {
    await montar(ctx('ktk_K'), { http: () => ok({ ...CONTA, papel: 'atendimento' }) });
    expect(raiz.textContent).toContain('está com a chave de atendimento');
  });

  it('rotaciona uma chave depois de confirmar e mostra a nova uma vez', async () => {
    const falso = await montar(ctx('kta_A'), {
      http: (c) => (c.url.includes('/rotacionar') ? ok({ chave: 'ktk_NOVA' }) : ok(CONTA)),
    });
    await clicar('Configurações');
    const gerar = [...raiz.querySelectorAll('button')].filter((b) => b.textContent === 'Gerar nova');
    await act(async () => {
      gerar[2].click();
    });
    await act(() => aguardar());
    expect(falso.chamadas.at(-1)).toMatchObject({ url: 'https://track.teste/v1/conta/chaves/atendimento/rotacionar', method: 'POST' });
    expect(raiz.textContent).toContain('ktk_NOVA');
  });

  it('não rotaciona se o admin cancelar', async () => {
    const falso = await montar(ctx('kta_A'), { http: () => ok(CONTA), confirmar: false });
    await clicar('Configurações');
    await clicar('Gerar nova');
    expect(falso.chamadas.filter((c) => c.url.includes('/rotacionar'))).toHaveLength(0);
  });
});
