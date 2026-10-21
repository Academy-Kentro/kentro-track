// Datas do Meta são dias no fuso da conta de anúncio ("YYYY-MM-DD"), não instantes.

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export function ehDia(texto: string): boolean {
  if (!DIA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** O dia de `agora` no fuso informado. */
export function diaNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Quantos dias de `de` até `ate`, contando os dois. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Todos os dias de `de` até `ate`, inclusive. */
export function cadaDia(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** Dia → Date à meia-noite UTC, como o Prisma grava colunas @db.Date. */
export function comoData(dia: string): Date {
  return new Date(`${dia}T00:00:00Z`);
}

export function comoDia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function horaNoFuso(instante: Date, fuso: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hour: '2-digit', hourCycle: 'h23' }).format(instante));
}

/** Próximo instante, depois de `agora`, em que o relógio do fuso marca `hora` cheia. */
export function proximaHoraLocal(agora: Date, fuso: string, hora: number): Date {
  const candidato = new Date(agora);
  candidato.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 49; i++) {
    candidato.setUTCHours(candidato.getUTCHours() + 1);
    if (horaNoFuso(candidato, fuso) === hora) return new Date(candidato);
  }
  // Fuso com meia hora de diferença: cai na hora cheia UTC mais próxima, um dia depois.
  return new Date(agora.getTime() + 86_400_000);
}
