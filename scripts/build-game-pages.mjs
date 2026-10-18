// Erzeugt eine eigene Seite pro Spiel unter games/<id>/index.html aus scripts/games.json:
// Beschreibung, Steuerung, Punkte, Tipps, Screenshot, Live-Vorschau und strukturierte Daten.
// Die Seiten sind generiert – Änderungen in games.json machen, dann neu erzeugen.
//
// Aufruf: node scripts/build-game-pages.mjs
// Screenshots (public/screens/<id>.webp) kommen aus scripts/screenshots.mjs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://arcadearena.sfalter.de';
const games = JSON.parse(readFileSync('scripts/games.json', 'utf8'));

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const indent = (text, n) => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function jsonLd(game) {
  const page = `${SITE}/games/${game.id}/`;
  const image = `${SITE}/screens/${game.id}.webp`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame',
        '@id': `${page}#game`,
        name: game.title,
        url: page,
        description: game.description,
        genre: game.genre,
        image,
        screenshot: { '@type': 'ImageObject', url: image, width: 768, height: 576, caption: game.alt },
        gamePlatform: 'Web browser',
        playMode: 'SinglePlayer',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web browser',
        inLanguage: 'en',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
        author: { '@id': `${SITE}/#author` },
        isPartOf: { '@id': `${SITE}/#arcade` },
        potentialAction: { '@type': 'PlayAction', target: `${SITE}/play/?game=${game.id}` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Arcade Arena', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: game.title, item: page },
        ],
      },
    ],
  };
  return indent(JSON.stringify(graph, null, 2), 6);
}

const COMMON_CONTROLS = [
  ['Start or pause', '<kbd>Enter</kbd>', 'Start'],
  ['Back to the hall', '<kbd>Esc</kbd>', 'Select'],
];

function page(game) {
  const url = `${SITE}/games/${game.id}/`;
  const image = `${SITE}/screens/${game.id}.webp`;
  const play = `/play/?game=${game.id}`;
  const others = games.filter((g) => g.id !== game.id);
  const controls = [...game.controls, ...COMMON_CONTROLS]
    .map(([action, keys, pad]) => `<tr><th scope="row">${esc(action)}</th><td>${keys}</td><td>${esc(pad)}</td></tr>`)
    .join('\n              ');
  const scoring = game.scoring
    .map(([what, pts]) => `<tr><th scope="row">${esc(what)}</th><td>${esc(pts)}</td></tr>`)
    .join('\n              ');

  return `<!doctype html>
<!-- Generiert von scripts/build-game-pages.mjs aus scripts/games.json – nicht von Hand bearbeiten. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(game.seoTitle)}</title>
    <meta name="description" content="${esc(game.metaDescription)}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#0b0816" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
    <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="preload" as="image" href="/screens/${game.id}.webp" type="image/webp" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Arcade Arena" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:title" content="${esc(game.seoTitle)}" />
    <meta property="og:description" content="${esc(game.metaDescription)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:type" content="image/webp" />
    <meta property="og:image:width" content="768" />
    <meta property="og:image:height" content="576" />
    <meta property="og:image:alt" content="${esc(game.alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(game.seoTitle)}" />
    <meta name="twitter:image" content="${image}" />

    <script type="application/ld+json">
${jsonLd(game)}
    </script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>

    <header class="nav">
      <a class="nav__logo" href="/" aria-label="Arcade Arena home">ARCADE ARENA</a>
      <nav aria-label="Main">
        <ul class="nav__links">
          <li><a href="/#games">Games</a></li>
          <li><a href="/#how">How it works</a></li>
          <li><a href="/#faq">FAQ</a></li>
        </ul>
      </nav>
      <a class="btn btn--small" href="/play/">Enter the arcade</a>
    </header>

    <main id="main" class="gamepage">
      <nav class="crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="/">Arcade Arena</a></li>
          <li><a href="/#games">Games</a></li>
          <li aria-current="page">${esc(game.title)}</li>
        </ol>
      </nav>

      <section class="hero" aria-labelledby="hero-title">
        <div class="hero__copy">
          <p class="eyebrow">Free browser arcade game</p>
          <h1 id="hero-title">${esc(game.h1)}</h1>
          <p class="hero__lead">${esc(game.lead)}</p>
          <div class="hero__actions">
            <a class="btn" href="${play}">Play ${esc(game.title)} now</a>
            <a class="btn btn--ghost" href="#how-to-play">How to play</a>
          </div>
        </div>
        <div class="screen screen--hero">
          <img src="/screens/${game.id}.webp" width="768" height="576" alt="${esc(game.alt)}" fetchpriority="high" />
          <canvas data-preview="${game.id}" width="384" height="288" aria-hidden="true"></canvas>
        </div>
      </section>

      <section id="how-to-play" class="rules" aria-labelledby="how-title">
        <div class="rules__text">
          <h2 id="how-title">How to play ${esc(game.title)}</h2>
${game.howTo.map((p) => `          <p>${esc(p)}</p>`).join('\n')}
        </div>
        <div class="rules__tables">
          <h3>Controls</h3>
          <table class="facts">
            <thead>
              <tr><th scope="col">Action</th><th scope="col">Keyboard</th><th scope="col">Gamepad</th></tr>
            </thead>
            <tbody>
              ${controls}
            </tbody>
          </table>
          <h3>Points</h3>
          <table class="facts">
            <tbody>
              ${scoring}
            </tbody>
          </table>
        </div>
      </section>

      <section class="tips" aria-labelledby="tips-title">
        <h2 id="tips-title">Tips for a higher score</h2>
        <ol class="tips__list">
${game.tips.map((t) => `          <li>${esc(t)}</li>`).join('\n')}
        </ol>
      </section>

      <section class="more" aria-labelledby="more-title">
        <h2 id="more-title">More games in the arcade</h2>
        <ul class="more__grid">
${others
  .map(
    (o) => `          <li>
            <a href="/games/${o.id}/">
              <img src="/screens/${o.id}.webp" width="768" height="576" alt="" loading="lazy" />
              <span class="more__title">${esc(o.title)}</span>
              <span class="more__style">${esc(/^[A-Z]/.test(o.style) ? `In the style of ${o.style}` : o.style.charAt(0).toUpperCase() + o.style.slice(1))}</span>
            </a>
          </li>`,
  )
  .join('\n')}
        </ul>
      </section>

      <section class="final" aria-labelledby="final-title">
        <h2 id="final-title">The ${esc(game.title)} high score table is waiting.</h2>
        <a class="btn" href="${play}">Play ${esc(game.title)} now</a>
      </section>
    </main>

    <footer class="footer">
      <p class="footer__brand">ARCADE ARENA</p>
      <p>
        An independent hobby project by Sebastian Falter,
        <a href="https://github.com/PsydoV2/ArcadeArena">source code on GitHub</a>. Space Invaders, Pac-Man, Breakout,
        Asteroids, Pong, Frogger, Missile Command, Columns, Lunar Lander and Centipede are trademarks of their respective
        owners. Arcade Arena is not affiliated with them.
      </p>
      <ul class="footer__links">
        <li><a href="/impressum/">Impressum</a></li>
        <li><a href="/datenschutz/">Datenschutz</a></li>
        <li><button class="footer__link" type="button" data-consent-open>Privacy settings</button></li>
      </ul>
    </footer>

    <section class="consent" data-consent-banner aria-labelledby="consent-title" hidden>
      <div class="consent__text">
        <h2 id="consent-title">Can we count your visit?</h2>
        <p>
          With your permission we use Umami, a privacy-friendly analytics tool hosted on our own server, to record how
          visitors use the site and which games get played. No ads, no tracking across other websites. You can change your
          choice any time under "Privacy settings" at the bottom of the page. Details:
          <a href="/datenschutz/">Datenschutzerklärung</a>.
        </p>
      </div>
      <div class="consent__actions">
        <button class="btn btn--small" type="button" data-consent="granted">Allow</button>
        <button class="btn btn--small btn--ghost" type="button" data-consent="denied">Decline</button>
      </div>
    </section>

    <script type="module" src="/src/game-page/main.ts"></script>
  </body>
</html>
`;
}

for (const game of games) {
  mkdirSync(`games/${game.id}`, { recursive: true });
  writeFileSync(`games/${game.id}/index.html`, page(game));
}
console.log(`wrote ${games.length} game pages to games/`);
