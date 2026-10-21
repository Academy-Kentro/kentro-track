// Leva para dist/ o que a API precisa em produção além do JS compilado (as extensões já saem
// em dist/extensao pelo build-extensoes.mjs). A VPS só leva a pasta dist/ (e o node_modules) para o contêiner.
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(import.meta.dirname, '..');
const dist = join(raiz, 'dist');

rmSync(join(dist, 'prisma'), { recursive: true, force: true });
cpSync(join(raiz, 'api', 'prisma'), join(dist, 'prisma'), { recursive: true });

console.log('dist/ pronto: main.js, extensao/, prisma/');
