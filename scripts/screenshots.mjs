// Erzeugt public/screens/<id>.webp für die Spielseiten: baut scripts/screenshots/capture.ts zu einer
// eigenständigen Seite, öffnet sie im Headless-Chrome und speichert die Bilder.
//
// Aufruf: node scripts/screenshots.mjs [Pfad zu chrome.exe/msedge.exe]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const CANDIDATES = [
  process.argv[2],
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const chrome = CANDIDATES.find((p) => p && existsSync(p));
if (!chrome) throw new Error('No Chrome or Edge found. Pass the path as the first argument.');

const tmp = mkdtempSync(join(tmpdir(), 'aa-shots-'));
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    outDir: join(tmp, 'build'),
    lib: { entry: 'scripts/screenshots/capture.ts', formats: ['iife'], name: 'capture', fileName: () => 'capture.js' },
  },
});
// Inline, damit die Seite auch über file:// ohne CORS-Probleme läuft
const page = join(tmp, 'capture.html');
writeFileSync(page, `<!doctype html><meta charset="utf-8"><pre id="out"></pre><script>${readFileSync(join(tmp, 'build', 'capture.js'), 'utf8').replace(/<\/script/g, '<\/script')}</script>`);

const dom = execFileSync(
  chrome,
  ['--headless=new', '--disable-gpu', `--user-data-dir=${join(tmp, 'profile')}`, '--dump-dom', pathToFileURL(page).href],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
);
const json = dom.match(/<pre id="out">([^<]*)<\/pre>/)?.[1];
if (!json) throw new Error(`No screenshot data in the page. Open ${page} in a browser and check the console.`);
const shots = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
mkdirSync('public/screens', { recursive: true });
const sheet = join(tmp, 'sheet.png');
writeFileSync(sheet, Buffer.from(shots.sheet.split(',')[1], 'base64'));
delete shots.sheet;
for (const [id, url] of Object.entries(shots)) {
  const data = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(`public/screens/${id}.webp`, data);
  console.log(`public/screens/${id}.webp  ${(data.length / 1024).toFixed(1)} kB`);
}
console.log(`contact sheet: ${sheet}`);
