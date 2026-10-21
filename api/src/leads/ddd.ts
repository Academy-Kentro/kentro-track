/** Estado (UF) pelo DDD do telefone brasileiro: a origem geográfica do lead sem pedir nada a ninguém. */
const FAIXAS: [number[], string][] = [
  [[11, 12, 13, 14, 15, 16, 17, 18, 19], 'SP'],
  [[21, 22, 24], 'RJ'],
  [[27, 28], 'ES'],
  [[31, 32, 33, 34, 35, 37, 38], 'MG'],
  [[41, 42, 43, 44, 45, 46], 'PR'],
  [[47, 48, 49], 'SC'],
  [[51, 53, 54, 55], 'RS'],
  [[61], 'DF'],
  [[62, 64], 'GO'],
  [[63], 'TO'],
  [[65, 66], 'MT'],
  [[67], 'MS'],
  [[68], 'AC'],
  [[69], 'RO'],
  [[71, 73, 74, 75, 77], 'BA'],
  [[79], 'SE'],
  [[81, 87], 'PE'],
  [[82], 'AL'],
  [[83], 'PB'],
  [[84], 'RN'],
  [[85, 88], 'CE'],
  [[86, 89], 'PI'],
  [[91, 93, 94], 'PA'],
  [[92, 97], 'AM'],
  [[95], 'RR'],
  [[96], 'AP'],
  [[98, 99], 'MA'],
];

const POR_DDD = new Map<number, string>(FAIXAS.flatMap(([ddds, uf]) => ddds.map((d) => [d, uf] as [number, string])));

export function ufDoDdd(ddd: number | string | null | undefined): string | null {
  return POR_DDD.get(Number(ddd)) ?? null;
}
