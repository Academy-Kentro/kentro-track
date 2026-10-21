import { Module } from '@nestjs/common';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ESPERAR, Esperar, Fetch, FETCH } from '../comum/fetch';
import { PrismaService } from '../comum/prisma.service';
import { CapiController } from '../capi/capi.controller';
import { CapiService } from '../capi/capi.service';
import { ContasModule } from '../contas/contas.module';
import { AtendimentoController, KentroController } from '../leads/leads.controller';
import { LeadsService } from '../leads/leads.service';
import { AnalisesService } from '../painel/analises.service';
import { MidiaController } from '../painel/midia.controller';
import { PainelController } from '../painel/painel.controller';
import { PainelService } from '../painel/painel.service';
import { ClienteGraph } from './cliente/graph';
import { ConexaoService } from './conexao/conexao.service';
import { MetaController } from './conexao/meta.controller';
import { AgendaSincronizacao } from './sincronizacao/agenda';
import { SincronizacaoService } from './sincronizacao/sincronizacao.service';

@Module({
  imports: [ContasModule],
  controllers: [MetaController, PainelController, MidiaController, AtendimentoController, KentroController, CapiController],
  providers: [
    {
      provide: ClienteGraph,
      inject: [CONFIG_APP, FETCH, ESPERAR, PrismaService],
      useFactory: (config: ConfigApp, fetch: Fetch, esperar: Esperar, prisma: PrismaService) =>
        new ClienteGraph({
          versao: config.metaVersaoApi,
          fetch,
          esperar,
          appSecret: config.meta?.appSecret ?? null,
          // Aba Saúde: operação, status, tempo e uso. Sem URL, token nem dado pessoal.
          registrar: (r) =>
            prisma.chamadaMeta.create({
              data: {
                contaId: r.contaId ?? null,
                operacao: r.operacao,
                statusHttp: r.statusHttp,
                ms: r.ms,
                erroCodigo: r.erroCodigo,
                uso: r.uso ? { pct: r.uso.pct, liberaEmSegundos: r.uso.liberaEmSegundos } : undefined,
              },
            }),
        }),
    },
    ConexaoService,
    SincronizacaoService,
    AgendaSincronizacao,
    PainelService,
    AnalisesService,
    LeadsService,
    CapiService,
  ],
  exports: [ClienteGraph, ConexaoService, SincronizacaoService],
})
export class MetaModule {}
