import type { Sound } from '../../engine/sound';

/** Tonleiter für Steine: obere Reihen klingen höher. */
const ROW_NOTES = [1047, 988, 880, 784, 698, 659, 587, 523];

export const sfx = {
  paddle(s: Sound) {
    s.tone({ freq: 330, dur: 0.06, type: 'square', vol: 0.18, jitter: 0.03 });
  },
  wall(s: Sound) {
    s.tone({ freq: 220, dur: 0.04, type: 'square', vol: 0.1 });
  },
  brick(s: Sound, row: number) {
    s.tone({ freq: ROW_NOTES[row % ROW_NOTES.length], dur: 0.08, type: 'square', vol: 0.16 });
  },
  hard(s: Sound) {
    s.tone({ freq: 1800, to: 1400, dur: 0.1, type: 'triangle', vol: 0.25 });
  },
  steel(s: Sound) {
    s.tone({ freq: 160, dur: 0.06, type: 'square', vol: 0.12 });
  },
  powerup(s: Sound) {
    s.seq([[523, 0.05], [659, 0.05], [784, 0.05], [1047, 0.1]], { type: 'square', vol: 0.15 });
  },
  lose(s: Sound) {
    s.tone({ freq: 440, to: 80, dur: 0.6, type: 'sawtooth', vol: 0.18 });
  },
  extraLife(s: Sound) {
    s.seq([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], { type: 'square', vol: 0.15 });
  },
  levelClear(s: Sound) {
    s.seq([[392, 0.1], [523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]], { type: 'triangle', vol: 0.35 });
  },
};
