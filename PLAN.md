# ArcadeArena – Projektplan

## Vision
Eine virtuelle Spielhalle im Browser für alle, die keine Lust auf moderne Spiele haben, bei denen man erst stundenlang Steuerung und Menüs lernen muss und nach einer Woche Pause wieder von vorn anfängt.

Wie früher in der Spielhalle: zum Automaten gehen, Münze rein, Joystick und zwei Knöpfe, eine halbe Stunde spielen, im Highscore verewigen, weiter zum nächsten Automaten.

## Zielgruppe
- Vor allem ältere Spieler, die mit klassischen Arcade-Spielen aufgewachsen sind
- Alle, die kurze Spielrunden ohne Einarbeitung suchen

## Festgelegte Entscheidungen
| Thema | Entscheidung |
|---|---|
| Darstellung der Halle | 2D (Pixel-Art, Neon-Look) |
| Sprache im Spiel | Englisch |
| Zielgerät | Desktop mit Tastatur, optional Gamepad |
| Highscores | Zuerst lokal (`localStorage`) |
| Startspiele | Space-Invaders-artig, Pac-Man-artig, Cockpit-Weltraum-Shooter |

## Designregeln
Diese Regeln gelten für jedes Spiel und für die Halle:

1. **Maximal 2 Klicks bis zum Spielstart.** Halle → Automat → „Insert Coin“ → los.
2. **Einheitliche Steuerung.** Pfeiltasten/WASD + maximal 2 Aktionstasten (z. B. Leertaste, Shift). `Esc` führt immer zurück in die Halle (mitten im Spiel nach kurzer Rückfrage, damit eine Runde nicht versehentlich verloren geht). Enter oder `P` pausiert.
3. **Sofort verständlich.** Die Steuerung ist als Grafik am Automaten abgebildet (wie das Frontpanel echter Automaten). Jedes Spiel erklärt sich in 5 Sekunden.
4. **Kurze Runden, kein Spielstand.** Eine Runde dauert 2–10 Minuten. Nach einer Woche Pause ist man trotzdem sofort wieder drin.
5. **Highscore-Tafel pro Automat.** Eintrag mit 3 Buchstaben, wie früher. Das ist der wichtigste Motivator.
6. **Gut lesbar.** Große Schrift, hoher Kontrast, keine hektische Benutzeroberfläche.
7. **Attract-Mode.** Automaten zeigen im Leerlauf eine Demo oder ihre Highscores.

## Die Halle
- Begehbare 2D-Halle in Draufsicht: eine Spielfigur läuft mit den Pfeiltasten durch die Halle (Kamera folgt), je 6 Automaten pro Reihe
- Vor einem Automaten öffnet sich ein Infofeld (Demo, Name, Steuerung, Highscore); Enter startet
- Mausklick auf einen Automaten: die Figur läuft selbst hin und startet das Spiel
- Durch die Ausgangstür geht es zurück zur Startseite
- Atmosphäre: Neonlicht, dezente Hintergrundgeräusche, CRT-Effekt (Scanlines, leichte Bildkrümmung)

## Startspiele

> Mechaniken sind frei verwendbar, Namen, Grafiken und Sounds der Originale aber nicht. Darum bekommen alle Spiele eigene Namen und eine eigene Optik. Die Namen unten sind Arbeitstitel.

### 1. Cosmic Siege (Space-Invaders-artig)
- Eine Kanone am unteren Bildschirmrand, Formationen von Aliens rücken von oben vor
- Deckungsblöcke, die nach und nach zerschossen werden
- Gelegentlich ein Bonus-UFO am oberen Rand
- Wellen werden schneller und dichter
- **Steuerung:** ← → bewegen, Leertaste schießen

### 2. Maze Muncher (Pac-Man-artig)
- Labyrinth mit Punkten, die eingesammelt werden müssen
- 4 Geister mit unterschiedlichem Verhalten (jagen, abschneiden, zufällig, scheu)
- Power-Pillen machen die Geister kurzzeitig fressbar
- Bonusfrüchte, Tunnel an den Seiten
- **Steuerung:** Pfeiltasten (keine Aktionstaste nötig)

### 3. Star Run (Cockpit-Weltraum-Shooter)
- Ego-Perspektive aus einem Raumschiff-Cockpit (Cockpitrahmen und Instrumente im Vordergrund)
- Das Schiff fliegt automatisch auf einem festen Pfad durchs All (Rail-Shooter)
- Asteroiden, Trümmer und Hindernisse kommen entgegen und müssen ausgewichen werden
- Gegnerische Jäger tauchen auf und müssen abgeschossen werden
- Pseudo-3D per perspektivischer Projektion auf Canvas 2D (Sternenfeld, skalierende Objekte)
- Abschnitte/Sektoren mit steigender Schwierigkeit, Schild statt Leben
- **Steuerung:** Pfeiltasten Schiff/Fadenkreuz bewegen, Leertaste schießen, optional Shift für Spezialwaffe

## Technik
- **Sprache/Build:** TypeScript + Vite (Node ist installiert)
- **Rendering:** Canvas 2D, feste interne Auflösung (z. B. 320×240 oder 384×288), pixelgenau hochskaliert
- **Sound:** WebAudio, synthetisierte Chiptune-Effekte (keine Audiodateien nötig)
- **Highscores:** `localStorage`, Top 10 pro Spiel, Eintrag mit 3 Buchstaben
- **Hosting (später):** statische Seite (Cloudflare Pages, Netlify oder GitHub Pages)

### Einheitliches Spiel-Interface
Jedes Spiel ist ein eigenes Modul. Die Halle kennt nur dieses Interface, so lassen sich neue Automaten einfach hinzufügen.

```ts
interface ArcadeGame {
  id: string;
  title: string;
  controls: ControlHint[];          // für das Steuerungsbild am Automaten
  init(ctx: GameContext): void;     // Canvas, Input, Audio, Highscore-API
  update(dt: number): void;
  render(): void;
  destroy(): void;
}
```

Gemeinsame Bausteine (Shared Engine):
- Game-Loop mit festem Zeitschritt
- Input-Handling (Tastatur, später Gamepad)
- Audio-Helfer für Chiptune-Sounds
- Highscore-Speicher und Namenseingabe
- Bitmap-Font im Retro-Stil
- CRT-Overlay

### Geplante Ordnerstruktur
```
ArcadeArena/
├─ index.html
├─ src/
│  ├─ main.ts
│  ├─ engine/        # Loop, Input, Audio, Highscores, Font, CRT
│  ├─ hall/          # Spielhalle und Automatenauswahl
│  └─ games/
│     ├─ cosmic-siege/
│     ├─ maze-muncher/
│     └─ star-run/
└─ public/           # ggf. Sprites, Fonts
```

## Roadmap
1. **MVP**
   - Projekt-Setup (Vite + TypeScript)
   - Shared Engine (Loop, Input, Audio, Highscores, Font)
   - Halle mit 3 Automaten
   - Cosmic Siege als erstes vollständiges Spiel
2. **Weitere Spiele:** Maze Muncher, Star Run
3. **Polish:** CRT-Effekt, Attract-Mode, Hallen-Atmosphäre, Feinschliff der Schwierigkeit
4. **Später (optional)**
   - Online-Highscores (z. B. Supabase oder Cloudflare Workers, mit Spamschutz)
   - Gamepad-Support
   - Weitere Automaten (z. B. Snake, Breakout, Pong, Tetris-artig)
   - Touch/Tablet-Support
