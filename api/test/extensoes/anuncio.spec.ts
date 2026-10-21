import { buscarAnuncio, diagnostico, primeiraComAnuncio, resumirAnuncio, temAnuncio } from '../../../extension/atendimento/src/anuncio';
import { omniFalso } from './omni-falso';

describe('resumirAnuncio', () => {
  it('lê o formato do webhook do WhatsApp (referral, snake_case)', () => {
    expect(
      resumirAnuncio({
        source_url: 'https://fb.me/abc',
        source_id: '120210000000001',
        source_type: 'ad',
        headline: 'Promoção de outubro',
        body: 'Fale com a gente no WhatsApp',
        ctwa_clid: 'Afd123',
        image_url: 'https://scontent.example/img.jpg',
      }),
    ).toEqual({
      url: 'https://fb.me/abc',
      idAnuncio: '120210000000001',
      tipo: 'ad',
      titulo: 'Promoção de outubro',
      texto: 'Fale com a gente no WhatsApp',
      ctwaClid: 'Afd123',
      midia: 'https://scontent.example/img.jpg',
    });
  });

  it('lê camelCase e um nível aninhado (ex.: { referral: {...} })', () => {
    expect(resumirAnuncio({ referral: { sourceId: 99, sourceUrl: 'https://instagram.com/p/x', title: 'Oferta' } })).toEqual({
      idAnuncio: '99',
      url: 'https://instagram.com/p/x',
      titulo: 'Oferta',
    });
  });

  it('lê o mesmo formato das variáveis das automações (message_ad_*)', () => {
    expect(resumirAnuncio({ message_ad_url: 'https://fb.me/z', message_ad_title: 'T', message_ad_body: 'B' })).toEqual({
      url: 'https://fb.me/z',
      titulo: 'T',
      texto: 'B',
    });
  });

  it('aceita o ad como texto: JSON, URL solta ou texto do anúncio', () => {
    expect(resumirAnuncio('{"headline":"Oi"}')).toEqual({ titulo: 'Oi' });
    expect(resumirAnuncio('https://fb.me/abc')).toEqual({ url: 'https://fb.me/abc' });
    expect(resumirAnuncio('Promoção')).toEqual({ texto: 'Promoção' });
  });

  it.each([null, undefined, '', '  ', {}, { headline: '' }, { a: null }, [], 0])('%p não é anúncio', (ad) => {
    expect(temAnuncio(ad)).toBe(false);
    expect(resumirAnuncio(ad)).toEqual({});
  });
});

describe('primeiraComAnuncio', () => {
  it('escolhe a mensagem mais antiga com anúncio', () => {
    const m = primeiraComAnuncio([
      { id: 3, at: '2026-10-21T10:03:00Z', ad: { headline: 'Depois' } },
      { id: 2, at: '2026-10-21T10:02:00Z', ad: null },
      { id: 1, at: '2026-10-21T10:01:00Z', ad: { headline: 'Primeiro' } },
    ]);
    expect(m?.id).toBe(1);
  });

  it('sem data, usa a ordem da página (da mais recente para a mais antiga)', () => {
    expect(primeiraComAnuncio([{ id: 'b', ad: { title: 'x' } }, { id: 'a', ad: { title: 'y' } }])?.id).toBe('a');
  });

  it('sem anúncio devolve null', () => {
    expect(primeiraComAnuncio([{ id: 1, ad: null }])).toBeNull();
  });
});

describe('buscarAnuncio', () => {
  const mensagens = (n: number, comAnuncioNo?: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `msg ${i + 1}`, ad: i + 1 === comAnuncioNo ? { headline: 'Achou' } : null }));

  it('recua página por página até achar o anúncio da primeira mensagem', async () => {
    const { omni, paginas } = omniFalso({ mensagens: mensagens(120, 1) });
    const busca = await buscarAnuncio(omni, 7);
    expect(busca.mensagem?.id).toBe(1);
    expect(busca.analisadas).toBe(120);
    expect(paginas).toEqual([{ chatId: 7, before: undefined }, { chatId: 7, before: 71 }, { chatId: 7, before: 21 }]);
  });

  it('para no teto de páginas em conversas muito longas', async () => {
    const { omni, paginas } = omniFalso({ mensagens: mensagens(500, 1) });
    const busca = await buscarAnuncio(omni, 7, 2);
    expect(paginas).toHaveLength(2);
    expect(busca).toEqual({ mensagem: null, analisadas: 100 });
  });

  it('o diagnóstico não leva o texto das mensagens', async () => {
    const { omni } = omniFalso({ mensagens: mensagens(3, 2) });
    const texto = diagnostico({ id: 7, channel: 'whatsapp' }, await buscarAnuncio(omni, 7));
    expect(texto).not.toContain('msg ');
    expect(JSON.parse(texto)).toMatchObject({ chatId: 7, canal: 'whatsapp', mensagensAnalisadas: 3, chavesDoAd: ['headline'], resumo: { titulo: 'Achou' } });
  });
});
