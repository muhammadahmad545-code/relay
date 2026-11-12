// Bundles the browser client into one self-contained HTML file shipped inside the APK.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'android', 'src', 'main', 'assets', 'relay-web');

const result = await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(here, 'index.template.html'), 'utf8').replace('/*__RELAY_SCRIPT__*/', () => script);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
console.log(`relay-web/index.html ${(html.length / 1024).toFixed(1)} KB`);
