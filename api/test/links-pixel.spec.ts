/**
 * @jest-environment jsdom
 */
import { LinksService } from '../src/links/links.service';

const BASE = 'https://track.teste/l/';
const script = new LinksService(null as never, { urlPublica: 'https://track.teste' } as never).scriptDoPixel();
const rodar = () => new Function(script)();

describe('pixel do site', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
  });

  it('leva os parâmetros da URL para os links rastreáveis, e só para eles', () => {
    history.replaceState(null, '', '/?utm_source=meta&gclid=G1&outro=x');
    document.body.innerHTML = `<a id="r" href="${BASE}abc">WhatsApp</a><a id="o" href="https://outro.example/l/abc">Outro</a>`;
    rodar();
    const url = new URL((document.getElementById('r') as HTMLAnchorElement).href);
    expect(url.searchParams.get('utm_source')).toBe('meta');
    expect(url.searchParams.get('gclid')).toBe('G1');
    expect(url.searchParams.has('outro')).toBe(false);
    expect((document.getElementById('o') as HTMLAnchorElement).href).toBe('https://outro.example/l/abc');
  });

  it('lembra de onde veio em outra página do site', () => {
    history.replaceState(null, '', '/?utm_campaign=BF');
    rodar();
    history.replaceState(null, '', '/contato');
    document.body.innerHTML = `<a id="r" href="${BASE}abc">WhatsApp</a>`;
    rodar();
    expect(new URL((document.getElementById('r') as HTMLAnchorElement).href).searchParams.get('utm_campaign')).toBe('BF');
  });

  it('o parâmetro já escrito no link vale mais que o guardado', () => {
    history.replaceState(null, '', '/?utm_source=meta');
    document.body.innerHTML = `<a id="r" href="${BASE}abc?utm_source=site">WhatsApp</a>`;
    rodar();
    expect(new URL((document.getElementById('r') as HTMLAnchorElement).href).searchParams.get('utm_source')).toBe('site');
  });

  it('link que apareceu depois é preparado no clique', () => {
    history.replaceState(null, '', '/?fbclid=F1');
    rodar();
    const a = document.createElement('a');
    a.href = `${BASE}abc`;
    a.addEventListener('click', (e) => e.preventDefault());
    document.body.appendChild(a);
    a.click();
    expect(new URL(a.href).searchParams.get('fbclid')).toBe('F1');
  });

  it('o que passou de 90 dias é esquecido', () => {
    localStorage.setItem('kentro_track', JSON.stringify({ ate: Date.now() - 1, p: { utm_source: 'velho' } }));
    document.body.innerHTML = `<a id="r" href="${BASE}abc">WhatsApp</a>`;
    rodar();
    expect((document.getElementById('r') as HTMLAnchorElement).href).toBe(`${BASE}abc`);
  });

  it('navegador que bloqueia o armazenamento não quebra o site', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    history.replaceState(null, '', '/?utm_source=meta');
    document.body.innerHTML = `<a id="r" href="${BASE}abc">WhatsApp</a>`;
    expect(rodar).not.toThrow();
    expect(new URL((document.getElementById('r') as HTMLAnchorElement).href).searchParams.get('utm_source')).toBe('meta');
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
