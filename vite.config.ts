import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Impressão digital do código que gera o relevo (textura, malha, horizonte e árvores distantes de cada chunk): o cache de chunks em disco
 * (chunkCache.ts) a usa como parte da chave, então qualquer mudança nesses arquivos descarta os chunks guardados em vez de mostrar relevo velho.
 * Fica fora dela o que não muda o resultado (sombreadores, desenho das árvores, interface).
 */
const GEN_DIRS = ['terrain', 'ecology', 'hydrology', 'geography', 'volcanology', 'geothermal', 'ice', 'math', 'seed', 'landmarks'];
const GEN_FILES = ['src/config.ts', 'src/generation/types.ts', 'src/generation/vegetation/vegetationPlanner.ts', 'src/generation/vegetation/pixelTrees/oreAssign.ts'];
const VIRTUAL = 'virtual:gen-hash';
const RESOLVED = '\0' + VIRTUAL;
// os arquivos desses diretórios que só desenham (não entram na geração): fora da impressão
const SKIP = /(chunk\.ts|chunkManager\.ts|horizonTerrain\.ts|terrainHeightField\.ts|textureUploadQueue\.ts|textureWorkerPool\.ts|textureForge\.worker\.ts)$/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !SKIP.test(p.replace(/\\/g, '/'))) out.push(p);
  }
}

function genHash(root: string): string {
  const files: string[] = [];
  for (const d of GEN_DIRS) {
    try { walk(join(root, 'src/generation', d), files); } catch { /* diretório que não existe */ }
  }
  for (const f of GEN_FILES) files.push(join(root, f));
  files.sort();
  const h = createHash('sha1');
  for (const f of files) {
    try { h.update(relative(root, f)).update(readFileSync(f)); } catch { /* arquivo que sumiu */ }
  }
  return h.digest('hex').slice(0, 16);
}

function genHashPlugin(): Plugin {
  let root = process.cwd();
  let hash = '';
  return {
    name: 'gen-hash',
    configResolved(cfg) { root = cfg.root; hash = genHash(root); },
    resolveId(id) { return id === VIRTUAL ? RESOLVED : null; },
    load(id) { return id === RESOLVED ? `export default ${JSON.stringify(hash)};` : null; },
    handleHotUpdate({ file, server }) {
      const f = file.replace(/\\/g, '/');
      if (!/\/src\/(generation|config\.ts)/.test(f)) return;
      const next = genHash(root);
      if (next === hash) return;
      hash = next;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [genHashPlugin()],
  // o worker do terreno (textureForge.worker.ts) também importa o cache de chunks (virtual:gen-hash): no build ele é empacotado à parte, com a própria lista de plugins
  worker: { plugins: () => [genHashPlugin()] },
  server: {
    port: 5173,
    open: false,
    // permite medir o jogo com o perfilador de JavaScript do navegador (só no servidor de desenvolvimento)
    headers: { 'Document-Policy': 'js-profiling' }
  },
  build: {
    target: 'esnext'
  }
});
