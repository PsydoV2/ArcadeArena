import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Öffentliche Adresse der Seite (für sitemap.xml, robots.txt, llms.txt). */
const SITE = 'https://arcadearena.sfalter.de';

/** Erzeugt sitemap.xml, robots.txt und llms.txt mit der echten Seitenadresse. */
function seoFiles(site: string): Plugin {
  const today = new Date().toISOString().slice(0, 10);
  const files: Record<string, string> = {
    'robots.txt': `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`,
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${site}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>
  <url><loc>${site}/play/</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
</urlset>
`,
    'llms.txt': `# Arcade Arena

> Arcade Arena is a free virtual arcade hall that runs in the web browser. Visitors walk up to a cabinet, press Enter and play original retro arcade games inspired by golden-age classics. No download, no account, no ads.

- Platform: any modern desktop web browser, keyboard or gamepad. Touch screens are not supported yet.
- Price: free.
- High scores: top 10 per game with three-letter initials, saved locally in the browser.
- Language: English.

## Games

- Cosmic Siege: fixed shooter in the style of Space Invaders. Arrow keys move, Space fires.
- Maze Muncher: maze chase game in the style of Pac-Man. Arrow keys only.
- Star Run: first-person cockpit rail shooter in pseudo-3D. Arrow keys steer, Space fires, Shift drops a bomb.
- Brick Blaster: brick breaker in the style of Breakout with power-ups. Arrow keys move the paddle, Space launches the ball.
<!-- more-games -->

## Links

- [Homepage](${site}/): overview, controls and FAQ
- [Play now](${site}/play/): the arcade hall
`.replace('<!-- more-games -->\n', ''),
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
      },
    },
  },
});
