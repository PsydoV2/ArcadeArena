import { Autopilot } from './autopilot';
import { drawText, textWidth } from './font';
import { lastInitials, saveInitials } from './highscores';
import type { Controls } from './input';
import * as C from './palette';
import { sfx } from './sfx';
import { Sound } from './sound';
import { SCREEN_H as H, SCREEN_W as W } from './types';
import type { ArcadeGame, CabinetInfo, ControlHint, GameContext } from './types';

/** Eine einzelne Spielrunde; den Rest (Titel, Highscores, Esc …) erledigt die Shell. */
export interface Round {
  readonly score: number;
  readonly over: boolean;
  update(dt: number): void;
  render(g: CanvasRenderingContext2D): void;
}

export interface RoundEnv {
  /** Tastatur – oder der Autopilot im Demo-Modus. */
  input: Controls;
  audio: Sound;
  /** Bester Eintrag der Tafel beim Start der Runde. */
  hiScore: number;
}

export interface GameDefinition {
  info: CabinetInfo;
  /** Kurze Erklärung, in 5 Sekunden lesbar. */
  howTo: string[];
  createRound(env: RoundEnv): Round;
  /** Optionale Punkte-Tabelle als zusätzliche Seite im Attract-Mode. */
  drawPoints?(g: CanvasRenderingContext2D, y: number): void;
}

type State = 'title' | 'playing' | 'paused' | 'gameover' | 'entry' | 'scores';
type Page = 'howto' | 'points' | 'scores' | 'demo';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PAGE_TIME: Record<Page, number> = { howto: 7, points: 6, scores: 7, demo: 30 };
/** Demo-Runden bleiben stumm. */
const SILENT = new Sound();

/** Gemeinsamer Automaten-Ablauf: Insert Coin → Spiel → Game Over → Initialen → Tafel. */
export class CabinetShell implements ArcadeGame {
  readonly id: string;
  readonly title: string;
  readonly controls: ControlHint[];

  private ctx!: GameContext;
  private state: State = 'title';
  private t = 0;
  private clock = 0;
  private round: Round | null = null;
  private initials: string[] = [];
  private cursor = 0;
  private rank = -1;
  private quitAsk = false;

  private pages: Page[];
  private pageIdx = 0;
  private pageT = 0;
  private demo: { round: Round; pilot: Autopilot } | null = null;

  private readonly onHide = () => {
    if (this.state === 'playing' && (document.hidden || !document.hasFocus())) this.pause(false);
  };

  constructor(private def: GameDefinition) {
    this.id = def.info.id;
    this.title = def.info.title;
    this.controls = def.info.controls;
    this.pages = ['howto', ...(def.drawPoints ? (['points'] as const) : []), 'scores', 'demo'];
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    window.addEventListener('blur', this.onHide);
    document.addEventListener('visibilitychange', this.onHide);
    this.setState('title');
  }

  destroy(): void {
    window.removeEventListener('blur', this.onHide);
    document.removeEventListener('visibilitychange', this.onHide);
    this.ctx.audio.stopLoops();
    this.round = null;
    this.demo = null;
  }

  update(dt: number): void {
    const { input } = this.ctx;
    this.t += dt;
    this.clock += dt;

    // Esc führt zurück in die Halle – mitten im Spiel erst nach Rückfrage
    if (input.pressed('back')) {
      if (this.state === 'playing') this.pause(true);
      else this.ctx.exit();
      return;
    }
    const go = input.pressed('start') || input.mouse.clicked;
    // Gamepad-Taste A bestätigt zusätzlich in Titel und Pause (nicht auf der Tafel – dort würde Dauerfeuer sofort neu starten)
    const goPad = go || input.padPressed('a');

    switch (this.state) {
      case 'title':
        if (goPad) this.startRound();
        else this.updateAttract(dt);
        break;
      case 'playing':
        if (input.pressed('start') || input.keyPressed('KeyP')) {
          this.pause(false);
          break;
        }
        this.round!.update(dt);
        if (this.round!.over) this.setState('gameover');
        break;
      case 'paused':
        if (goPad || input.keyPressed('KeyP')) {
          sfx.blip(this.ctx.audio);
          this.setState('playing');
        } else if (input.keyPressed('KeyM')) {
          this.ctx.audio.toggleMute();
          sfx.blip(this.ctx.audio);
        }
        break;
      case 'gameover':
        if (this.t > 2.5) {
          this.rank = this.ctx.scores.rankOf(this.round!.score);
          if (this.rank >= 0) {
            this.initials = lastInitials().split('');
            this.cursor = 0;
            sfx.fanfare(this.ctx.audio);
            this.setState('entry');
          } else {
            this.setState('scores');
          }
        }
        break;
      case 'entry':
        this.updateEntry();
        break;
      case 'scores':
        if (go) this.startRound();
        else if (this.t > 20) this.setState('title');
        break;
    }
  }

  render(): void {
    const g = this.ctx.g;
    const k = this.keyLabels;
    switch (this.state) {
      case 'title':
        this.renderTitle(g);
        break;
      case 'playing':
        this.round!.render(g);
        break;
      case 'paused':
        this.round!.render(g);
        if (this.quitAsk) {
          this.banner(g, 'QUIT GAME?', C.ORANGE, [`${k.back} = YES, BACK TO HALL`, `${k.ok} = NO, KEEP PLAYING`]);
        } else {
          this.banner(g, 'PAUSED', C.CYAN, [
            `${k.ok} = CONTINUE     ${k.back} = QUIT`,
            `M = SOUND ${this.ctx.audio.muted ? 'OFF' : 'ON'}`,
          ]);
        }
        break;
      case 'gameover':
        this.round!.render(g);
        this.banner(g, 'GAME OVER', C.RED);
        break;
      case 'entry':
        this.renderEntry(g);
        break;
      case 'scores':
        this.renderScores(g);
        break;
    }
  }

  private setState(s: State) {
    this.state = s;
    this.t = 0;
    if (s !== 'playing') this.ctx.audio.stopLoops();
    if (s === 'title') {
      this.pageIdx = 0;
      this.pageT = 0;
      this.demo = null;
    }
  }

  private pause(quitAsk: boolean) {
    this.quitAsk = quitAsk;
    sfx.blip(this.ctx.audio);
    this.setState('paused');
  }

  private startRound() {
    sfx.coin(this.ctx.audio);
    this.rank = -1;
    this.demo = null;
    this.round = this.def.createRound({
      input: this.ctx.input,
      audio: this.ctx.audio,
      hiScore: this.ctx.scores.best(),
    });
    this.setState('playing');
  }

  private updateAttract(dt: number) {
    this.pageT += dt;
    const page = this.pages[this.pageIdx];
    if (page === 'demo') {
      if (!this.demo) {
        const pilot = new Autopilot(this.def.info.controls);
        const round = this.def.createRound({ input: pilot, audio: SILENT, hiScore: this.ctx.scores.best() });
        this.demo = { round, pilot };
      }
      this.demo.pilot.tick(dt);
      this.demo.round.update(dt);
    }
    if (this.pageT > PAGE_TIME[page] || this.demo?.round.over) {
      this.pageIdx = (this.pageIdx + 1) % this.pages.length;
      this.pageT = 0;
      this.demo = null;
    }
  }

  private updateEntry() {
    const { input, audio } = this.ctx;
    const letter = (d: number) => {
      const i = LETTERS.indexOf(this.initials[this.cursor]);
      this.initials[this.cursor] = LETTERS[(i + d + LETTERS.length) % LETTERS.length];
      sfx.blip(audio);
    };

    for (const ch of input.typed) {
      if (ch.length === 1 && LETTERS.includes(ch)) {
        this.initials[this.cursor] = ch;
        if (this.cursor < 2) this.cursor++;
        sfx.blip(audio);
      }
    }
    // Nur Pfeiltasten bzw. Steuerkreuz – W/A/S/D sind hier Buchstaben
    const nav = (key: string, pad: 'up' | 'down' | 'left' | 'right') => input.keyPressed(key) || input.padPressed(pad);
    if (nav('ArrowUp', 'up')) letter(1);
    if (nav('ArrowDown', 'down')) letter(-1);
    if (nav('ArrowRight', 'right') && this.cursor < 2) this.cursor++;
    if ((nav('ArrowLeft', 'left') || input.keyPressed('Backspace') || input.padPressed('b')) && this.cursor > 0) {
      this.cursor--;
    }

    if (input.pressed('start') || input.padPressed('a')) {
      if (this.cursor < 2) {
        this.cursor++;
        sfx.blip(audio);
      } else {
        const name = this.initials.join('');
        saveInitials(name);
        this.rank = this.ctx.scores.add(name, this.round!.score);
        sfx.confirm(audio);
        this.setState('scores');
      }
    }
  }

  // ---------- Darstellung ----------

  /** Tastennamen passend zum Eingabegerät. */
  private get keyLabels() {
    return this.ctx.input.padActive ? { ok: 'START', back: 'SELECT' } : { ok: 'ENTER', back: 'ESC' };
  }

  private renderTitle(g: CanvasRenderingContext2D) {
    const k = this.keyLabels;
    const { info } = this.def;
    const page = this.pages[this.pageIdx];

    if (page === 'demo' && this.demo) {
      this.demo.round.render(g);
      // Banner oben – dort steht nur die Punkteanzeige, die in der Demo egal ist
      g.fillStyle = 'rgba(0,0,0,0.82)';
      g.fillRect(0, 0, W, 34);
      g.fillStyle = C.alpha(info.color, 0.6);
      g.fillRect(0, 34, W, 1);
      drawText(g, 'DEMO', 10, 4, { color: C.DIM });
      if (this.clock % 1 < 0.65) {
        drawText(g, 'INSERT COIN', W / 2, 4, { scale: 2, color: C.YELLOW, align: 'center', glow: true });
      }
      drawText(g, `PRESS ${k.ok} TO PLAY`, W / 2, 23, { color: C.WHITE, align: 'center' });
      return;
    }

    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    drawText(g, info.title, W / 2, 22, { scale: 4, color: info.color, align: 'center', glow: true });
    g.fillStyle = C.alpha(info.color, 0.5);
    g.fillRect(40, 56, W - 80, 1);

    if (page === 'howto') {
      drawText(g, 'HOW TO PLAY', W / 2, 66, { color: info.accent, align: 'center' });
      info.controls.forEach((c, i) => {
        drawText(g, `${c.keys} ${c.label}`, W / 2, 82 + i * 18, { scale: 2, color: C.YELLOW, align: 'center' });
      });
      const top = 92 + info.controls.length * 18;
      const fits = this.def.howTo.every((line) => textWidth(line, 2) <= W - 16);
      this.def.howTo.forEach((line, i) => {
        drawText(g, line, W / 2, top + i * (fits ? 17 : 12), { scale: fits ? 2 : 1, color: C.WHITE, align: 'center' });
      });
    } else if (page === 'points') {
      drawText(g, 'SCORE TABLE', W / 2, 66, { color: info.accent, align: 'center' });
      this.def.drawPoints!(g, 86);
    } else {
      drawText(g, 'HIGH SCORES', W / 2, 66, { color: info.accent, align: 'center' });
      this.renderTable(g, 84, 2, 17, 8);
    }

    if (this.clock % 1 < 0.65) {
      drawText(g, 'INSERT COIN', W / 2, 230, { scale: 2, color: C.YELLOW, align: 'center', glow: true });
    }
    drawText(g, `${k.ok} = START     ${k.back} = HALL`, W / 2, 262, { color: C.DIM, align: 'center' });
  }

  private renderEntry(g: CanvasRenderingContext2D) {
    const k = this.keyLabels;
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    drawText(g, 'NEW HIGH SCORE!', W / 2, 22, { scale: 3, color: C.YELLOW, align: 'center', glow: true });
    drawText(g, `SCORE ${this.round!.score}`, W / 2, 62, { scale: 2, color: C.WHITE, align: 'center' });
    drawText(g, `RANK ${this.rank + 1}`, W / 2, 84, { scale: 2, color: C.CYAN, align: 'center' });
    drawText(g, 'ENTER YOUR INITIALS', W / 2, 114, { scale: 2, color: this.def.info.accent, align: 'center' });

    const blink = this.clock % 0.6 < 0.4;
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 60 + i * 40;
      const active = i === this.cursor;
      drawText(g, this.initials[i], x + 20, 138, {
        scale: 5,
        color: active ? (blink ? C.YELLOW : C.ORANGE) : C.WHITE,
        align: 'center',
        glow: active,
      });
      g.fillStyle = active ? C.YELLOW : C.DIM;
      g.fillRect(x + 6, 178, 28, 2);
    }

    drawText(g, '↑↓ CHANGE LETTER     ←→ MOVE', W / 2, 200, { color: C.WHITE, align: 'center' });
    drawText(g, 'OR SIMPLY TYPE YOUR INITIALS', W / 2, 214, { color: C.DIM, align: 'center' });
    drawText(g, `PRESS ${k.ok} WHEN DONE`, W / 2, 240, { scale: 2, color: C.YELLOW, align: 'center' });
  }

  private renderScores(g: CanvasRenderingContext2D) {
    const k = this.keyLabels;
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    drawText(g, 'HIGH SCORES', W / 2, 16, { scale: 3, color: this.def.info.color, align: 'center', glow: true });
    this.renderTable(g, 50, 2, 17);
    if (this.rank < 0 && this.round) {
      drawText(g, `YOUR SCORE ${this.round.score}`, W / 2, 226, { color: C.CYAN, align: 'center' });
    }
    drawText(g, `${k.ok} = PLAY AGAIN`, W / 2, 246, { scale: 2, color: C.YELLOW, align: 'center' });
    drawText(g, `${k.back} = BACK TO HALL`, W / 2, 268, { color: C.DIM, align: 'center' });
  }

  private renderTable(g: CanvasRenderingContext2D, y: number, scale: number, pitch: number, max = 10) {
    const blink = this.clock % 0.5 < 0.3;
    const entries = this.ctx.scores.list().slice(0, max);
    // Freie Plätze als Striche, damit die Tafel auch ohne Einträge nach Automat aussieht
    for (let i = entries.length; i < max; i++) {
      const line = `${String(i + 1).padStart(2, ' ')}. ---  ${'-'.padStart(6, ' ')}`;
      drawText(g, line, W / 2, y + i * pitch, { scale, color: C.DIM, align: 'center' });
    }
    entries.forEach((e, i) => {
      const line = `${String(i + 1).padStart(2, ' ')}. ${e.name}  ${String(e.score).padStart(6, ' ')}`;
      let color = i === 0 ? C.YELLOW : i < 3 ? C.ORANGE : C.WHITE;
      if (i === this.rank) color = blink ? C.CYAN : C.WHITE;
      drawText(g, line, W / 2, y + i * pitch, { scale, color, align: 'center' });
    });
  }

  private banner(g: CanvasRenderingContext2D, text: string, color: string, lines: string[] = []) {
    const h = 52 + lines.length * 14;
    g.fillStyle = 'rgba(0,0,0,0.8)';
    g.fillRect(0, 106, W, h);
    g.fillStyle = C.alpha(color, 0.6);
    g.fillRect(0, 106, W, 1);
    g.fillRect(0, 106 + h - 1, W, 1);
    drawText(g, text, W / 2, 118, { scale: 4, color, align: 'center', glow: true });
    lines.forEach((line, i) => drawText(g, line, W / 2, 156 + i * 14, { color: C.WHITE, align: 'center' }));
  }
}
