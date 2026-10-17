# Arcade Arena

Eine virtuelle Spielhalle im Browser. Man läuft durch eine Neon-Halle, stellt sich vor einen Automaten, drückt Enter und spielt. Keine Anmeldung, kein Download, keine Einarbeitung, Highscore-Tafel mit drei Initialen wie früher.

Gedacht vor allem für Spielerinnen und Spieler, die mit klassischen Arcade-Spielen aufgewachsen sind: große Schrift, hoher Kontrast, überall dieselbe Steuerung, kurze Runden.

**Live:** https://arcadearena.sfalter.de

## Die Spiele

Alle Spiele sind eigene Umsetzungen klassischer Spielprinzipien, mit eigenen Namen, Grafiken und Sounds.

| Automat | Im Stil von | Steuerung |
|---|---|---|
| Cosmic Siege | Space Invaders | ←→ bewegen, Leertaste feuern |
| Star Run | Cockpit-Rail-Shooter (3D-Wireframe) | Pfeile lenken, Leertaste feuern, Shift Bombe |
| Rock Buster | Asteroids | ←→ drehen, ↑ Schub, Leertaste feuern, Shift Warp |
| City Defender | Missile Command | Pfeile zielen, Leertaste feuern |
| Garden Guard | Centipede | Pfeile bewegen, Leertaste feuern |
| Moon Lander | Lunar Lander | ←→ drehen, Leertaste Schub |
| Maze Muncher | Pac-Man | Pfeile |
| Neon Serpent | Snake | Pfeile |
| Road Hopper | Frogger | Pfeile |
| Brick Blaster | Breakout | ←→ bewegen, Leertaste Ball starten |
| Gem Cascade | Columns | ←→ bewegen, ↓ schneller, Leertaste tauschen, Shift fallen lassen |
| Paddle Duel | Pong (gegen den Computer) | ↑↓ |

## Bedienung

| | Tastatur | Gamepad |
|---|---|---|
| Laufen / bewegen | Pfeiltasten oder WASD | Steuerkreuz oder linker Stick |
| Aktion 1 | Leertaste | A / X |
| Aktion 2 | Shift | B / Y |
| Spiel starten, Pause | Enter (Pause auch mit P) | Start |
| Zurück in die Halle | Esc (im Spiel mit Rückfrage) | Select / Back |
| Ton an/aus | M (in der Halle und im Pausenmenü) | |
| Vollbild | F (in der Halle) | |

In der Halle reicht auch die Maus: Ein Klick auf einen Automaten lässt die Figur hinlaufen und startet das Spiel. Durch die EXIT-Tür geht es zurück zur Startseite.

## Entwicklung

Voraussetzung: Node.js (getestet mit Node 24).

```bash
npm install
npm run dev       # Entwicklungsserver
npm run build     # Typprüfung + Produktions-Build nach dist/
npm run preview   # fertigen Build lokal ansehen
```

Die Seite hat zwei Einstiegspunkte:

- `/` (`index.html`): Landingpage mit Live-Vorschauen der Spiele, FAQ und strukturierten Daten
- `/play/` (`play/index.html`): die Spielhalle

## Technik

- TypeScript und Vite, ohne Framework und ohne Laufzeit-Abhängigkeiten
- Canvas 2D mit fester interner Auflösung (384×288), pixelgenau hochskaliert, mit CRT-Effekt (Scanlines, Vignette, Neon-Glühen)
- Sound komplett mit WebAudio synthetisiert, keine Audiodateien
- Highscores (Top 10 pro Spiel) und Einstellungen in `localStorage`, nichts wird an einen Server geschickt
- Schriften selbst gehostet über Fontsource (Pixelify Sans, Atkinson Hyperlegible)

### Ordnerstruktur

```text
index.html            Landingpage
play/index.html       Spielhalle
src/
  main.ts             Einstieg der Halle: Szenenwechsel Halle ↔ Spiel
  engine/             Gemeinsame Bausteine
    loop.ts             Game-Loop mit festem Zeitschritt (60 Hz)
    input.ts            Tastatur, Maus, Gamepad
    sound.ts, sfx.ts    WebAudio-Synthese, Endlos-Sounds, gemeinsame Effekte
    shell.ts            Automaten-Ablauf: Titel, Demo, Pause, Game Over, Initialen, Highscores
    autopilot.ts        "Demo-Spieler" für den Attract-Mode
    font.ts, draw.ts    Bitmap-Font, Sprites, pixelgenaue Linien
    screen.ts           Skalierung, CRT-Effekt, Vollbild
    highscores.ts       Highscore-Tafeln
  hall/hall.ts        Die begehbare Halle
  games/<name>/       Ein Ordner pro Spiel (index.ts + round.ts, ggf. Sprites/Sounds)
  games/registry.ts   Aufstellung der Automaten in der Halle
  landing/            Script und Styles der Landingpage
scripts/
  add-landing-game.mjs  trägt ein neues Spiel auf der Landingpage ein
```

## Ein neues Spiel hinzufügen

Jedes Spiel liefert nur seine eigentliche Spielrunde. Titelbildschirm, Demo-Modus, Pause, Game Over, Initialen-Eingabe und Highscore-Tafel kommen automatisch aus `CabinetShell`.

1. **Spielrunde** in `src/games/<name>/round.ts`: eine Klasse, die `Round` aus `src/engine/shell.ts` umsetzt (`update(dt)`, `render(g)`, `score`, `over`). Eingaben kommen über `env.input`, Sound über `env.audio`. Dadurch funktioniert der Demo-Modus mit Autopilot ohne Zusatzaufwand.
2. **Automat** in `src/games/<name>/index.ts`: ein `CabinetInfo` (Name, Kurzbeschreibung, Farben, Steuerung, kleine Demo für den Automatenbildschirm) und eine `GameDefinition` (Anleitung, optionale Punktetabelle, `createRound`).
3. **Aufstellen** in `src/games/registry.ts`: den Automaten in `CABINETS` eintragen. Die Halle hat 6 Automaten pro Reihe und wächst automatisch um weitere Reihen.
4. **Landingpage**: eine kleine JSON-Datei mit Titel, Beschreibung, Tasten usw. anlegen und

   ```bash
   node scripts/add-landing-game.mjs pfad/zur/spec.json
   ```

   ausführen. Das Skript ergänzt Spielkachel mit Live-Vorschau, strukturierte Daten (JSON-LD), `llms.txt` und die Vorschau-Zuordnung. Es lässt sich gefahrlos wiederholen. Welche Felder die JSON-Datei braucht, steht im Kopf des Skripts.

Designregeln für alle Spiele (siehe `PLAN.md`): Pfeiltasten plus höchstens zwei Aktionstasten, in fünf Sekunden verständlich, Runden von 2 bis 10 Minuten, gut lesbare Schrift.

## Veröffentlichen

`npm run build` erzeugt eine rein statische Seite in `dist/`, die auf jedem statischen Hosting läuft (z. B. Cloudflare Pages, Netlify, GitHub Pages).

Die öffentliche Adresse `https://arcadearena.sfalter.de` steht fest in `index.html`, `play/index.html`, `vite.config.ts` und `scripts/add-landing-game.mjs`. Sie wird für Canonical-Links, Open Graph, strukturierte Daten, `sitemap.xml`, `robots.txt` und `llms.txt` verwendet. `sitemap.xml`, `robots.txt` und `llms.txt` erzeugt `vite.config.ts` beim Build.

## Rechtliches

Arcade Arena ist ein unabhängiges Hobbyprojekt. Spielmechaniken sind frei verwendbar, deshalb haben alle Spiele eigene Namen, Grafiken und Sounds. Space Invaders, Pac-Man, Asteroids, Breakout, Pong, Frogger, Missile Command, Centipede, Lunar Lander und Columns sind Marken ihrer jeweiligen Inhaber; Arcade Arena steht mit ihnen in keiner Verbindung.
