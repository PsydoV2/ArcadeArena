import type { Input } from './input';
import type { Sound } from './sound';
import type { ScoreBoard } from './highscores';

/** Feste interne Auflösung, wird pixelgenau hochskaliert. */
export const SCREEN_W = 384;
export const SCREEN_H = 288;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eintrag für das Steuerungsbild am Automaten. */
export interface ControlHint {
  type: 'stick' | 'button';
  keys: string;
  label: string;
}

export interface GameContext {
  g: CanvasRenderingContext2D;
  width: number;
  height: number;
  input: Input;
  audio: Sound;
  scores: ScoreBoard;
  /** Zurück in die Halle. */
  exit(): void;
}

export interface ArcadeGame {
  id: string;
  title: string;
  controls: ControlHint[];
  init(ctx: GameContext): void;
  update(dt: number): void;
  render(): void;
  destroy(): void;
}

/** Alles, was die Halle über einen Automaten wissen muss. */
export interface CabinetInfo {
  id: string;
  title: string;
  /** Ein Satz, der in der Halle unter dem ausgewählten Automaten steht. */
  tagline: string;
  /** Neon-Hauptfarbe (Marquee, Zierleisten). */
  color: string;
  accent: string;
  controls: ControlHint[];
  /** Mini-Demo auf dem Automatenbildschirm in der Halle. */
  attract?(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void;
  /** Fehlt, solange das Spiel noch nicht fertig ist ("Coming soon"). */
  create?(): ArcadeGame;
}
