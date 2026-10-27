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

/** Cidade que dá nome à área de cada DDD (a área cobre a região em volta). */
const CIDADES: Record<number, string> = {
  11: 'São Paulo', 12: 'São José dos Campos', 13: 'Santos', 14: 'Bauru', 15: 'Sorocaba', 16: 'Ribeirão Preto', 17: 'São José do Rio Preto', 18: 'Presidente Prudente', 19: 'Campinas',
  21: 'Rio de Janeiro', 22: 'Campos dos Goytacazes', 24: 'Volta Redonda', 27: 'Vitória', 28: 'Cachoeiro de Itapemirim',
  31: 'Belo Horizonte', 32: 'Juiz de Fora', 33: 'Governador Valadares', 34: 'Uberlândia', 35: 'Poços de Caldas', 37: 'Divinópolis', 38: 'Montes Claros',
  41: 'Curitiba', 42: 'Ponta Grossa', 43: 'Londrina', 44: 'Maringá', 45: 'Cascavel', 46: 'Pato Branco', 47: 'Joinville', 48: 'Florianópolis', 49: 'Chapecó',
  51: 'Porto Alegre', 53: 'Pelotas', 54: 'Caxias do Sul', 55: 'Santa Maria',
  61: 'Brasília', 62: 'Goiânia', 63: 'Palmas', 64: 'Rio Verde', 65: 'Cuiabá', 66: 'Rondonópolis', 67: 'Campo Grande', 68: 'Rio Branco', 69: 'Porto Velho',
  71: 'Salvador', 73: 'Ilhéus', 74: 'Juazeiro', 75: 'Feira de Santana', 77: 'Vitória da Conquista', 79: 'Aracaju',
  81: 'Recife', 82: 'Maceió', 83: 'João Pessoa', 84: 'Natal', 85: 'Fortaleza', 86: 'Teresina', 87: 'Petrolina', 88: 'Juazeiro do Norte', 89: 'Picos',
  91: 'Belém', 92: 'Manaus', 93: 'Santarém', 94: 'Marabá', 95: 'Boa Vista', 96: 'Macapá', 97: 'Interior do Amazonas', 98: 'São Luís', 99: 'Imperatriz',
};

export function cidadeDoDdd(ddd: number | string | null | undefined): string | null {
  return CIDADES[Number(ddd)] ?? null;
}
