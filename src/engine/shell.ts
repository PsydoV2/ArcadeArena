import { drawText } from './font';
import { lastInitials, saveInitials } from './highscores';
import * as C from './palette';
import { sfx } from './sfx';
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
  ctx: GameContext;
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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PAGE_TIME = 6;

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

  private readonly onBlur = () => {
    if (this.state === 'playing') this.setState('paused');
  };

  constructor(private def: GameDefinition) {
    this.id = def.info.id;
    this.title = def.info.title;
    this.controls = def.info.controls;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    window.addEventListener('blur', this.onBlur);
    this.setState('title');
  }

  destroy(): void {
    window.removeEventListener('blur', this.onBlur);
    this.round = null;
  }

  update(dt: number): void {
    const { input } = this.ctx;
    this.t += dt;
    this.clock += dt;

    if (input.pressed('back')) {
      this.ctx.exit();
      return;
    }
    const go = input.pressed('start') || input.mouse.clicked;

    switch (this.state) {
      case 'title':
        if (go) this.startRound();
        break;
      case 'playing':
        this.round!.update(dt);
        if (this.round!.over) this.setState('gameover');
        break;
      case 'paused':
        if (go) this.setState('playing');
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
    switch (this.state) {
      case 'title':
        this.renderTitle(g);
        break;
      case 'playing':
        this.round!.render(g);
        break;
      case 'paused':
        this.round!.render(g);
        this.banner(g, 'PAUSED', C.CYAN, 'PRESS ENTER TO CONTINUE');
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
  }

  private startRound() {
    sfx.coin(this.ctx.audio);
    this.rank = -1;
    this.round = this.def.createRound({ ctx: this.ctx, hiScore: this.ctx.scores.best() });
    this.setState('playing');
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
    if (input.keyPressed('ArrowUp')) letter(1);
    if (input.keyPressed('ArrowDown')) letter(-1);
    if (input.keyPressed('ArrowRight') && this.cursor < 2) this.cursor++;
    if ((input.keyPressed('ArrowLeft') || input.keyPressed('Backspace')) && this.cursor > 0) this.cursor--;

    if (input.pressed('start')) {
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

  private renderTitle(g: CanvasRenderingContext2D) {
    const { info } = this.def;
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    drawText(g, info.title, W / 2, 22, { scale: 4, color: info.color, align: 'center', glow: true });
    g.fillStyle = C.alpha(info.color, 0.5);
    g.fillRect(40, 56, W - 80, 1);

    const pages = ['howto', ...(this.def.drawPoints ? ['points'] : []), 'scores'];
    const page = pages[Math.floor(this.clock / PAGE_TIME) % pages.length];

    if (page === 'howto') {
      drawText(g, 'HOW TO PLAY', W / 2, 68, { color: info.accent, align: 'center' });
      info.controls.forEach((c, i) => {
        drawText(g, `${c.keys} ${c.label}`, W / 2, 86 + i * 20, { scale: 2, color: C.WHITE, align: 'center' });
      });
      const top = 96 + info.controls.length * 20;
      this.def.howTo.forEach((line, i) => {
        drawText(g, line, W / 2, top + i * 12, { color: C.WHITE, align: 'center' });
      });
    } else if (page === 'points') {
      drawText(g, 'SCORE TABLE', W / 2, 68, { color: info.accent, align: 'center' });
      this.def.drawPoints!(g, 88);
    } else {
      drawText(g, 'HIGH SCORES', W / 2, 68, { color: info.accent, align: 'center' });
      this.renderTable(g, 86, 1, 13);
    }

    if (this.clock % 1 < 0.65) {
      drawText(g, 'INSERT COIN', W / 2, 228, { scale: 2, color: C.YELLOW, align: 'center', glow: true });
    }
    drawText(g, 'ENTER = START     ESC = HALL', W / 2, 262, { color: C.DIM, align: 'center' });
  }

  private renderEntry(g: CanvasRenderingContext2D) {
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    drawText(g, 'NEW HIGH SCORE!', W / 2, 22, { scale: 3, color: C.YELLOW, align: 'center', glow: true });
    drawText(g, `SCORE ${this.round!.score}`, W / 2, 62, { scale: 2, color: C.WHITE, align: 'center' });
    drawText(g, `RANK ${this.rank + 1}`, W / 2, 84, { scale: 2, color: C.CYAN, align: 'center' });
    drawText(g, 'ENTER YOUR INITIALS', W / 2, 116, { color: this.def.info.accent, align: 'center' });

    const blink = this.clock % 0.6 < 0.4;
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 60 + i * 40;
      const active = i === this.cursor;
      drawText(g, this.initials[i], x + 20, 136, {
        scale: 5,
        color: active ? (blink ? C.YELLOW : C.ORANGE) : C.WHITE,
        align: 'center',
        glow: active,
      });
      g.fillStyle = active ? C.YELLOW : C.DIM;
      g.fillRect(x + 6, 176, 28, 2);
    }

    drawText(g, '↑↓ CHANGE LETTER     ←→ MOVE', W / 2, 200, { color: C.WHITE, align: 'center' });
    drawText(g, 'OR SIMPLY TYPE YOUR INITIALS', W / 2, 214, { color: C.DIM, align: 'center' });
    drawText(g, 'PRESS ENTER WHEN DONE', W / 2, 240, { scale: 2, color: C.YELLOW, align: 'center' });
  }

  private renderScores(g: CanvasRenderingContext2D) {
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    drawText(g, 'HIGH SCORES', W / 2, 16, { scale: 3, color: this.def.info.color, align: 'center', glow: true });
    this.renderTable(g, 50, 2, 17);
    if (this.rank < 0 && this.round) {
      drawText(g, `YOUR SCORE ${this.round.score}`, W / 2, 226, { color: C.CYAN, align: 'center' });
    }
    drawText(g, 'ENTER = PLAY AGAIN', W / 2, 248, { color: C.YELLOW, align: 'center' });
    drawText(g, 'ESC = BACK TO HALL', W / 2, 262, { color: C.DIM, align: 'center' });
  }

  private renderTable(g: CanvasRenderingContext2D, y: number, scale: number, pitch: number) {
    const blink = this.clock % 0.5 < 0.3;
    this.ctx.scores.list().forEach((e, i) => {
      const line = `${String(i + 1).padStart(2, ' ')}. ${e.name}  ${String(e.score).padStart(6, ' ')}`;
      let color = i === 0 ? C.YELLOW : i < 3 ? C.ORANGE : C.WHITE;
      if (i === this.rank) color = blink ? C.CYAN : C.WHITE;
      drawText(g, line, W / 2, y + i * pitch, { scale, color, align: 'center' });
    });
  }

  private banner(g: CanvasRenderingContext2D, text: string, color: string, sub?: string) {
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(0, 112, W, sub ? 64 : 52);
    drawText(g, text, W / 2, 124, { scale: 4, color, align: 'center', glow: true });
    if (sub) drawText(g, sub, W / 2, 162, { color: C.WHITE, align: 'center' });
  }
}
