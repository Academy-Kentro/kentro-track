// Compila cada extensão (Preact) num FRAGMENTO de HTML: <style> + <div id="app"> + <script> clássico.
// É o formato que a Kentro já monta no iframe (painel do Kentro Shop): o SDK `omni` chega como global
// antes do script, sem <html>/<body>, sem módulo e sem arquivo a mais para buscar com CORS.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { build } from 'vite';

const raiz = join(import.meta.dirname, '..');
const extensoes = JSON.parse(readFileSync(join(raiz, 'extension', 'extensoes.json'), 'utf8'));

/** Um "</script" dentro do JS fecharia a tag antes da hora. */
const protegerScript = (js) => js.replace(/<\/script/gi, '<\\/script');

for (const { pasta, html, arquivos = [] } of extensoes) {
  const origem = join(raiz, 'extension', pasta);
  const temporaria = mkdtempSync(join(tmpdir(), `kentro-track-${pasta}-`));
  try {
    await build({
      configFile: false,
      root: origem,
      logLevel: 'warn',
      plugins: [preact()],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: temporaria,
        emptyOutDir: true,
        cssCodeSplit: false,
        target: 'es2019',
        lib: { entry: join(origem, 'src', 'main.tsx'), formats: ['iife'], name: 'KentroTrack', fileName: () => 'app.js' },
      },
    });
    const gerados = readdirSync(temporaria);
    const js = readFileSync(join(temporaria, 'app.js'), 'utf8');
    const css = gerados.filter((a) => a.endsWith('.css')).map((a) => readFileSync(join(temporaria, a), 'utf8')).join('\n');
    // Sem CSS a tela monta "crua" na Kentro sem erro nenhum: melhor quebrar o build.
    if (!css.trim()) throw new Error(`extensão ${pasta}: o build não gerou CSS.`);

    const destino = join(raiz, 'dist', 'extensao', pasta);
    rmSync(destino, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });
    const fragmento = `<!-- Gerado por scripts/build-extensoes.mjs a partir de extension/${pasta}/src. Não edite. -->\n<style>\n${css}\n</style>\n<div id="app"></div>\n<script>\n${protegerScript(js)}\n</script>\n`;
    writeFileSync(join(destino, html), fragmento);
    copyFileSync(join(origem, 'manifest.json'), join(destino, 'manifest.json'));
    for (const arquivo of arquivos) copyFileSync(join(origem, arquivo), join(destino, arquivo));
    console.log(`extensão ${pasta}: dist/extensao/${pasta}/${html} (${(fragmento.length / 1024).toFixed(1)} KB)`);
  } finally {
    rmSync(temporaria, { recursive: true, force: true });
  }
}
