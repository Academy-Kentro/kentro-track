// Gera extension/gestao/src/mapa-brasil.ts (contorno dos estados para o mapa de leads por DDD) a partir
// da malha do IBGE, já baixada:
//   https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF
// Uso: node scripts/gerar-mapa-brasil.mjs caminho/da/malha.json
// Troca o código IBGE pela sigla da UF e arredonda as coordenadas para 2 casas (~1 km), o que basta
// para um mapa de ~300 px e corta o arquivo pela metade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UF_POR_CODIGO = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

const [origem] = process.argv.slice(2);
if (!origem) throw new Error('informe o caminho da malha do IBGE (GeoJSON).');
const malha = JSON.parse(readFileSync(origem, 'utf8'));

const arredondar = (n) => Math.round(n * 100) / 100;
/** Anel com coordenadas arredondadas e sem pontos repetidos em sequência; null se virar um risco. */
function anel(pontos) {
  const saida = [];
  for (const [x, y] of pontos) {
    const p = [arredondar(x), arredondar(y)];
    const ultimo = saida.at(-1);
    if (!ultimo || ultimo[0] !== p[0] || ultimo[1] !== p[1]) saida.push(p);
  }
  return saida.length >= 4 ? saida : null;
}
const poligono = (aneis) => aneis.map(anel).filter(Boolean);

const features = malha.features.map((f) => {
  const uf = UF_POR_CODIGO[Number(f.properties.codarea)];
  if (!uf) throw new Error(`código IBGE desconhecido: ${f.properties.codarea}`);
  const { type, coordinates } = f.geometry;
  const geometry =
    type === 'Polygon'
      ? { type, coordinates: poligono(coordinates) }
      : { type, coordinates: coordinates.map(poligono).filter((p) => p.length) };
  return { type: 'Feature', properties: { name: uf }, geometry };
});
if (features.length !== 27) throw new Error(`esperava 27 estados, vieram ${features.length}.`);

const destino = join(import.meta.dirname, '..', 'extension', 'gestao', 'src', 'mapa-brasil.ts');
const geojson = JSON.stringify({ type: 'FeatureCollection', features });
writeFileSync(
  destino,
  `// Gerado por scripts/gerar-mapa-brasil.mjs a partir da malha de estados do IBGE (qualidade mínima). Não edite.\n` +
    `// Cada estado tem properties.name = sigla da UF, que é o nome usado na série do mapa.\n` +
    `export const MAPA_BRASIL = ${geojson};\n`,
);
console.log(`mapa-brasil.ts: ${features.length} estados, ${(geojson.length / 1024).toFixed(1)} KB`);
