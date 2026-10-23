import { cadaDia, diaNoFuso, diasEntre, ehDia, proximaHoraLocal, somarDias } from '../../src/comum/datas';
import { normalizarInsight } from '../../src/meta/sincronizacao/insights';
import { tarefasDevidas } from '../../src/meta/sincronizacao/sincronizacao.service';
import type { ContaAnuncio } from '@prisma/client';

describe('datas no fuso da conta de anúncio', () => {
  it('o dia muda no fuso, não em UTC', () => {
    const instante = new Date('2026-10-21T02:30:00Z'); // 23h30 do dia 20 em São Paulo
    expect(diaNoFuso(instante, 'America/Sao_Paulo')).toBe('2026-10-20');
    expect(diaNoFuso(instante, 'UTC')).toBe('2026-10-21');
  });

  it('soma dias, conta intervalos e lista os dias', () => {
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(diasEntre('2026-10-01', '2026-10-30')).toBe(30);
    expect(cadaDia('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('valida o formato do dia', () => {
    expect(ehDia('2026-10-21')).toBe(true);
    expect(ehDia('2026-02-30')).toBe(false);
    expect(ehDia('21/10/2026')).toBe(false);
  });

  it('próximas 4h no horário de São Paulo', () => {
    expect(proximaHoraLocal(new Date('2026-10-21T10:00:00Z'), 'America/Sao_Paulo', 4).toISOString()).toBe('2026-10-22T07:00:00.000Z');
    expect(proximaHoraLocal(new Date('2026-10-21T06:59:00Z'), 'America/Sao_Paulo', 4).toISOString()).toBe('2026-10-21T07:00:00.000Z');
  });
});

describe('normalizarInsight', () => {
  const ids = { contaId: 'c', contaAnuncioId: 'ca' };

  it('converte texto em número e separa formulário, site e conversa', () => {
    const n = normalizarInsight(
      {
        ad_id: '1',
        adset_id: '2',
        campaign_id: '3',
        date_start: '2026-10-20',
        spend: '123.456',
        impressions: '1000',
        reach: '800',
        clicks: '50',
        inline_link_clicks: '30',
        actions: [
          { action_type: 'lead', value: '7' },
          { action_type: 'onsite_conversion.lead_grouped', value: '5' },
          { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' },
          { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
        ],
        action_values: [{ action_type: 'purchase', value: '99.9' }],
      },
      ids,
    );
    expect(n).toMatchObject({
      anuncioIdMeta: '1',
      conjuntoIdMeta: '2',
      campanhaIdMeta: '3',
      impressoes: 1000,
      alcance: 800,
      cliques: 50,
      cliquesLink: 30,
      leadsFormulario: 5,
      leadsSite: 2,
      conversas: 4,
      acoes: { lead: 7, 'onsite_conversion.lead_grouped': 5, 'offsite_conversion.fb_pixel_lead': 2, 'onsite_conversion.messaging_conversation_started_7d': 4 },
      valoresAcoes: { purchase: 99.9 },
    });
    expect(String(n.investimento)).toBe('123.46');
    expect((n.data as Date).toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('linha sem ações nem números vira zeros', () => {
    expect(normalizarInsight({ ad_id: '1', adset_id: '2', campaign_id: '3', date_start: '2026-10-20' }, ids)).toMatchObject({
      impressoes: 0,
      leadsFormulario: 0,
      conversas: 0,
      acoes: {},
    });
  });
});

describe('tarefasDevidas', () => {
  const agora = new Date('2026-10-21T12:00:00Z');
  const antes = new Date('2026-10-21T11:00:00Z');
  const depois = new Date('2026-10-21T13:00:00Z');
  const conta = (c: Partial<ContaAnuncio>) => ({ proximaEntidadesEm: null, proximaHorariaEm: null, proximoRecalculoEm: null, cargaConcluidaEm: null, ...c }) as ContaAnuncio;

  it('conta nova: os números antes da lista de campanhas e anúncios', () => {
    expect(tarefasDevidas(conta({}), agora)).toEqual(['carga', 'entidades']);
  });

  it('carga com erro espera o horário da nova tentativa', () => {
    expect(tarefasDevidas(conta({ proximaEntidadesEm: depois, proximaHorariaEm: depois }), agora)).toEqual([]);
  });

  it('depois da carga: recálculo tem prioridade sobre a horária (cobre os mesmos dias)', () => {
    const base = { cargaConcluidaEm: antes, proximaEntidadesEm: depois };
    expect(tarefasDevidas(conta({ ...base, proximaHorariaEm: antes, proximoRecalculoEm: antes }), agora)).toEqual(['recalculo']);
    expect(tarefasDevidas(conta({ ...base, proximaHorariaEm: antes, proximoRecalculoEm: depois }), agora)).toEqual(['horaria']);
    expect(tarefasDevidas(conta({ ...base, proximaHorariaEm: depois, proximoRecalculoEm: depois }), agora)).toEqual([]);
  });
});
