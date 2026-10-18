// Trägt ein neues Spiel auf der Landingpage ein: Spielkachel mit Live-Vorschau und Link zur Spielseite,
// strukturierte Daten (JSON-LD), die Vorschau-Zuordnung im Landing-Script und den Screenshot-Eintrag.
// Für die Spielseite danach einen Eintrag in scripts/games.json anlegen (dort steht auch der llms.txt-Text)
// und node scripts/screenshots.mjs sowie node scripts/build-game-pages.mjs ausführen.
//
// Aufruf: node scripts/add-landing-game.mjs <spec.json>
// spec: { id, title, module, exportName, genre[], style, description, text, keysHtml, alt, llms }

import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const SITE = 'https://arcadearena.sfalter.de';

/** Fügt text vor marker ein – übersprungen, wenn key schon vorkommt (Skript ist wiederholbar). */
function insertBefore(file, marker, text, key) {
  const s = readFileSync(file, 'utf8');
  if (s.includes(key)) return;
  if (s.split(marker).length !== 2) throw new Error(`${file}: marker not found exactly once: ${marker}`);
  writeFileSync(file, s.replace(marker, text + marker));
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

insertBefore(
  'index.html',
  '<!-- more-games -->',
  `<article class="game" aria-labelledby="g-${spec.id}">
            <div class="screen">
              <canvas
                data-preview="${spec.id}"
                width="384"
                height="288"
                role="img"
                aria-label="${esc(spec.alt)}"
              ></canvas>
            </div>
            <div class="game__text">
              <h3 id="g-${spec.id}">${spec.title}</h3>
              <p>
                ${spec.text}
              </p>
              <p class="keys">${spec.keysHtml}</p>
              <a class="game__link" href="/games/${spec.id}/">How to play ${spec.title}</a>
            </div>
          </article>
          `,
  `data-preview="${spec.id}"`,
);

const ld = {
  '@type': 'VideoGame',
  name: spec.title,
  url: `${SITE}/games/${spec.id}/`,
  image: `${SITE}/screens/${spec.id}.webp`,
  description: spec.description,
  genre: spec.genre,
  gamePlatform: 'Web browser',
  playMode: 'SinglePlayer',
  applicationCategory: 'GameApplication',
  operatingSystem: 'Web browser',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  author: { '@id': `${SITE}/#author` },
  isPartOf: { '@id': `${SITE}/#arcade` },
};
const ldText = JSON.stringify(ld, null, 2)
  .split('\n')
  .map((l) => '          ' + l)
  .join('\n');
insertBefore('index.html', '          {\n            "@type": "FAQPage",', `${ldText},\n`, `"name": "${spec.title}"`);

insertBefore(
  'src/landing/main.ts',
  '// more-imports',
  `import { ${spec.exportName} } from '../games/${spec.module}';\n`,
  `import { ${spec.exportName} }`,
);
insertBefore('src/landing/main.ts', '  // more-previews', `  '${spec.id}': ${spec.exportName},\n`, `'${spec.id}':`);

insertBefore(
  'scripts/screenshots/capture.ts',
  '// more-imports',
  `import { ${spec.exportName} } from '../../src/games/${spec.module}';\n`,
  `import { ${spec.exportName} }`,
);
insertBefore('scripts/screenshots/capture.ts', '  // more-shots', `  ['${spec.id}', ${spec.exportName}, 8],\n`, `['${spec.id}',`);

console.log(`added ${spec.title} to the landing page - now add it to scripts/games.json`);
