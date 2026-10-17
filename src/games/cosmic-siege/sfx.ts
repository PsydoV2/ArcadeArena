import type { Sound } from '../../engine/sound';

const MARCH = [98, 87, 78, 73];

export const sfx = {
  shoot(s: Sound) {
    s.tone({ freq: 1200, to: 300, dur: 0.12, type: 'square', vol: 0.12 });
  },
  alienHit(s: Sound) {
    s.noise({ dur: 0.18, freq: 4000, to: 300, vol: 0.35 });
    s.tone({ freq: 400, to: 80, dur: 0.15, type: 'triangle', vol: 0.3 });
  },
  march(s: Sound, step: number) {
    s.tone({ freq: MARCH[step % MARCH.length], dur: 0.1, type: 'square', vol: 0.22 });
  },
  ufo(s: Sound, high: boolean) {
    s.tone({ freq: high ? 760 : 620, dur: 0.1, type: 'sawtooth', vol: 0.06 });
  },
  ufoHit(s: Sound) {
    s.seq([[523, 0.06], [659, 0.06], [784, 0.06], [1047, 0.14]], { type: 'square', vol: 0.18 });
  },
  bombHit(s: Sound) {
    s.noise({ dur: 0.08, freq: 2500, to: 400, vol: 0.15 });
  },
  playerDeath(s: Sound) {
    s.noise({ dur: 1.1, freq: 2000, to: 80, vol: 0.5 });
    s.tone({ freq: 300, to: 40, dur: 1.0, type: 'sawtooth', vol: 0.2 });
  },
  extraLife(s: Sound) {
    s.seq([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], { type: 'square', vol: 0.15 });
  },
  waveClear(s: Sound) {
    s.seq([[392, 0.1], [523, 0.1], [659, 0.1], [784, 0.3]], { type: 'triangle', vol: 0.35 });
  },
};
