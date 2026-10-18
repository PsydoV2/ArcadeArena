import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Öffentliche Adresse der Seite (für sitemap.xml und llms.txt). */
const SITE = 'https://arcadearena.sfalter.de';

/** Spiele mit eigener Seite unter /games/<id>/ (Inhalte: scripts/games.json, Seiten: scripts/build-game-pages.mjs). */
const GAMES: { id: string; title: string; llms: string }[] = JSON.parse(
  readFileSync(resolve(__dirname, 'scripts/games.json'), 'utf8'),
);

/** Datum des letzten Commits, der die Pfade geändert hat (für ein ehrliches lastmod). */
function lastChanged(...paths: string[]): string {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...paths], { encoding: 'utf8' }).trim();
    if (date) return date;
  } catch {}
  return new Date().toISOString().slice(0, 10);
}

/** Erzeugt sitemap.xml und llms.txt mit der echten Seitenadresse (robots.txt kommt beim Deployen dazu). */
function seoFiles(site: string): Plugin {
  const gamePages = GAMES.map(
    (g) => `  <url><loc>${site}/games/${g.id}/</loc><lastmod>${lastChanged(`games/${g.id}`)}</lastmod></url>\n`,
  ).join('');
  const gameList = GAMES.map((g) => `- [${g.title}](${site}/games/${g.id}/): ${g.llms}\n`).join('');
  const files: Record<string, string> = {
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${site}/</loc><lastmod>${lastChanged('index.html')}</lastmod></url>
  <url><loc>${site}/play/</loc><lastmod>${lastChanged('play', 'src')}</lastmod></url>
${gamePages}</urlset>
`,
    'llms.txt': `# Arcade Arena

> Arcade Arena is a free virtual arcade hall that runs in the web browser. Visitors walk through the hall, step up to a cabinet, press Enter and play original retro arcade games inspired by golden-age classics. No download, no account, no ads.

- Platform: any modern desktop web browser, keyboard or gamepad. Touch screens are not supported yet.
- Price: free.
- High scores: top 10 per game with three-letter initials, saved locally in the browser.
- Language: English.

## Games

Each game has its own page with rules, controls, points and tips.

${gameList}
## Links

- [Homepage](${site}/): overview, controls and FAQ
- [Play now](${site}/play/): the arcade hall
- Start a game directly: ${site}/play/?game=<id>, for example ${site}/play/?game=${GAMES[0].id}
`,
  };
  return {
    name: 'seo-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.slice(1) ?? '';
        if (!(name in files)) return next();
        res.setHeader('Content-Type', name.endsWith('.xml') ? 'application/xml' : 'text/plain; charset=utf-8');
        res.end(files[name]);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

export default defineConfig({
  plugins: [seoFiles(SITE)],
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play/index.html'),
        impressum: resolve(__dirname, 'impressum/index.html'),
        datenschutz: resolve(__dirname, 'datenschutz/index.html'),
        notFound: resolve(__dirname, '404.html'),
        ...Object.fromEntries(GAMES.map((g) => [`game-${g.id}`, resolve(__dirname, `games/${g.id}/index.html`)])),
      },
    },
  },
});
