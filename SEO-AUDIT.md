# SEO/AEO-Audit: Arcade Arena

**Site:** https://arcadearena.sfalter.de
**Datum:** 2026-10-18
**Seiten geprüft:** 2 (`/`, `/play/`)
**Gesamtwertung: 74/100**

Die technische Basis ist ungewöhnlich gut. Die Startseite enthält ihren ganzen Text schon im HTML, die JSON-LD-Daten passen zum sichtbaren Inhalt, und es gibt `llms.txt`, Canonical-Tags, HSTS und gzip. Der größte Mangel liegt im Aufbau der Seite: Für alle 12 Spiele gibt es nur eine einzige URL.

## Kritisch (sollte behoben werden)

- [ ] **Der Server liefert eine falsche `robots.txt` aus.** Live kommt ein Next.js-Template mit `Disallow: /_next/data/`, `Allow: /*.js$` usw. zurück. Der Build erzeugt aber korrekt `User-agent: * / Allow: /` (siehe `dist/robots.txt`). Irgendetwas auf dem Server überschreibt die Datei, vermutlich Plesk oder ein alter Upload. Im Moment schadet das noch nicht, aber die Datei ist nicht unter deiner Kontrolle. → Datei auf dem Server prüfen oder entfernen.
- [ ] **Keine eigene Seite pro Spiel.** Alle 12 `VideoGame`-Einträge in `index.html:62-311` zeigen auf dieselbe URL `/play/`. Damit kann keine Seite gezielt für Suchanfragen wie „snake game online free“, „pac-man style game browser“ oder „pong against computer“ ranken. KI-Suchen haben ebenfalls keine URL, die sie für ein bestimmtes Spiel zitieren können. → Pro Spiel eine statische Seite anlegen, z. B. `/games/neon-serpent/`, mit H1, Beschreibung, Steuerung, Screenshot, eigenem `VideoGame`-Schema und einem Startlink wie `/play/?game=neon-serpent`. Die Vite-Multi-Page-Konfiguration und `scripts/add-landing-game.mjs` lassen sich dafür erweitern. **Das bringt mit Abstand am meisten.**
- [ ] **Veraltete Texte, die für Vertrauen und AEO wichtig sind:**
  - `play/index.html:7`: Die Meta-Description nennt nur 3 Spiele, es gibt aber 12.
  - `index.html:348` und `:733`: Die FAQ-Antwort „Are these the original arcade games?“ nennt nur Cosmic Siege, Maze Muncher und Star Run.
  - `index.html:756`: Der Marken-Hinweis im Footer nennt nur Space Invaders und Pac-Man. Die Seite verwendet aber auch Breakout, Asteroids, Pong, Frogger, Missile Command, Columns, Lunar Lander und Centipede. Das ist auch rechtlich relevant.

## Warnungen (sollten behoben werden)

- [ ] **Es gibt keine crawlbaren Bilder.** Alle Spielvorschauen sind `<canvas>`-Elemente. Google Images findet daher nichts, und im Schema fehlen `image` und `screenshot`. → Pro Spiel einen WebP-Screenshot erzeugen. Er kann als Fallback im Canvas oder als `poster` dienen und im JSON-LD verlinkt werden.
- [ ] **Keine Angabe, wer die Seite gemacht hat.** Es fehlen ein `Person`- oder `Organization`-Schema, `author`/`publisher` im `WebApplication`- und `VideoGame`-Schema sowie `sameAs` (z. B. das GitHub-Repo). Ohne diese Angaben können KI-Suchen die Seite keinem Absender zuordnen. → Eine kleine „About“-Zeile im Footer und das passende Schema ergänzen.
- [ ] **Die H1 enthält keine Keywords.** „Classic arcade games. No manual required.“ lässt „free“, „browser“ und „online“ weg (`index.html:380`). Der Title deckt das ab, die H1 sollte es auch tun, z. B. „Free retro arcade games in your browser“ mit dem bisherigen Satz als Unterzeile.
- [ ] **Gehashte Assets haben kein `Cache-Control`.** `/assets/*.js` wird nur über das ETag revalidiert. → Für `/assets/` `Cache-Control: public, max-age=31536000, immutable` setzen (in `.htaccess` oder in Plesk).
- [ ] **Die 404-Seite ist die Standardseite von Apache** (HTML 2.0, iso-8859-1). → Eine eigene `404.html` mit Links zur Startseite und zur Halle anlegen.
- [ ] **`/play/` ist fast leer.** Die Seite enthält nur einen `<noscript>`-Satz, kein OG-Bild und kein Schema. Das ist für eine App in Ordnung. Wird sie geteilt, fehlt aber die Vorschau. → OG- und Twitter-Tags von der Startseite übernehmen.

## Chancen (nice to have)

- [ ] **FAQ-Rich-Results:** Google zeigt sie seit 2023 praktisch nur noch für Behörden- und Gesundheitsseiten. Das Schema ist trotzdem sinnvoll für AEO (ChatGPT, Perplexity, AI Overviews). Es lohnt sich, mehr Fragen in Suchsprache aufzunehmen, z. B. „What free arcade games can I play in my browser?“ oder „Is there a Pac-Man style game I can play online?“
- [ ] **`sitemap.xml`:** `lastmod` ist immer das Build-Datum (`vite.config.ts:9`), und Google ignoriert unzuverlässige Werte. `priority` wird ohnehin ignoriert. Mit eigenen Spielseiten wächst die Sitemap automatisch.
- [ ] **Eine deutsche Version mit `hreflang`:** Die Domain ist `.de` und die Zielgruppe „grew up in arcades“. Deutsche Suchanfragen wie „Retro Spiele kostenlos online“ sind deutlich weniger umkämpft.
- [ ] **Backlinks und Erwähnungen:** Die Seite liegt auf einer Subdomain einer persönlichen Domain und hat wenig Autorität. Einträge bei itch.io, r/WebGames, Hacker News („Show HN“) und Product Hunt bringen Links und machen die Seite für KI-Suchen sichtbarer.
- [ ] `og:locale`, `twitter:title` und `twitter:image` fehlen. Twitter greift auf die OG-Tags zurück, die Ergänzung wäre also nur eine Kleinigkeit.
- [ ] `llms.txt` ist gut. Mit Spielseiten sollte jeder Eintrag einen eigenen Link bekommen.

## Was schon gut ist

- Der ganze Inhalt steht statisch im HTML und braucht kein JavaScript. Das ist ideal für Crawler und KI-Bots.
- Der Title hat 53 Zeichen und die Description 159, beide enthalten die Keywords. Canonical, Viewport, `lang="en"` und Favicons/Manifest sind vollständig.
- Die Überschriften sind sauber gegliedert (h1 → h2 → h3), und es gibt einen Skip-Link, `aria-labelledby` und aussagekräftige `aria-label` auf den Canvas-Vorschauen.
- Das JSON-LD ist sauber als `@graph` mit `@id`-Verweisen aufgebaut, und das FAQ-Schema stimmt mit dem sichtbaren FAQ überein.
- `llms.txt` beschreibt Spiele, Steuerung, Preis und Plattform klar. Das ist sehr gute AEO-Grundlage.
- Die Seite ist leicht: Startseite rund 35 KB HTML, CSS 2,5 KB gz, Startskript 0,9 KB gz (dazu lädt ein Preload rund 52 KB gz Spielcode). Das Hosting antwortet in unter 100 ms und leitet HTTP per 301 auf HTTPS weiter. HSTS ist aktiv.
- Mit dem Consent-Banner wird Umami erst nach Zustimmung geladen, ohne Tracking-Skripte vorab.

## Empfohlene Reihenfolge

1. `robots.txt` auf dem Server korrigieren und die veralteten Texte aktualisieren (etwa 15 Minuten).
2. Seiten pro Spiel mit Screenshots anlegen.
3. Autor-Schema, Caching-Header und eigene 404-Seite ergänzen.
