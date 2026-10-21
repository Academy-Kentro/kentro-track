import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigApp, CONFIG_APP } from '../../comum/config';
import { CapiService } from '../../capi/capi.service';
import { PrismaService } from '../../comum/prisma.service';
import { SincronizacaoService } from './sincronizacao.service';

const CICLO_MS = 30_000;
/** Contas de anúncio por ciclo: o resto fica para o próximo, sem fila crescendo na memória. */
const POR_CICLO = 5;
const LIMPEZA_MS = 60 * 60_000;
const DIAS_REGISTRO = 7;

@Injectable()
export class AgendaSincronizacao implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Agenda');
  private relogio?: NodeJS.Timeout;
  private rodando = false;
  private ultimaLimpeza = 0;

  constructor(
    private readonly sincronizacao: SincronizacaoService,
    private readonly capi: CapiService,
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.sincronizacaoAutomatica) return;
    this.relogio = setInterval(() => void this.ciclo(), CICLO_MS);
    this.relogio.unref();
  }

  onModuleDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
  }

  /** Um ciclo por vez: se o anterior ainda roda (relatório grande), este pula. */
  async ciclo(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      // Eventos primeiro: são rápidos e o atraso aparece para o cliente (otimização das campanhas).
      await this.capi.enviarPendentes();
      for (let i = 0; i < POR_CICLO; i++) if (!(await this.sincronizacao.executarProxima())) break;
      if (Date.now() - this.ultimaLimpeza > LIMPEZA_MS) {
        this.ultimaLimpeza = Date.now();
        await this.prisma.chamadaMeta.deleteMany({ where: { em: { lt: new Date(Date.now() - DIAS_REGISTRO * 86_400_000) } } });
      }
    } catch (erro) {
      this.logger.error(erro instanceof Error ? erro.stack ?? erro.message : String(erro));
    } finally {
      this.rodando = false;
    }
  }
}
