import type { Sound } from '../../engine/sound';

export const sfx = {
  laser(s: Sound) {
    s.tone({ freq: 1500, to: 450, dur: 0.08, type: 'square', vol: 0.07 });
  },
  explode(s: Sound, big = false) {
    s.noise({ dur: big ? 0.7 : 0.4, freq: 2500, to: 100, vol: big ? 0.5 : 0.35 });
    s.tone({ freq: 160, to: 40, dur: big ? 0.6 : 0.3, type: 'sawtooth', vol: 0.15 });
  },
  hitRock(s: Sound) {
    s.tone({ freq: 220, to: 120, dur: 0.06, type: 'square', vol: 0.12 });
  },
  plasma(s: Sound) {
    s.tone({ freq: 300, to: 700, dur: 0.15, type: 'sine', vol: 0.1 });
  },
  hurt(s: Sound) {
    s.noise({ dur: 0.35, freq: 900, to: 100, vol: 0.55 });
    s.tone({ freq: 90, dur: 0.3, type: 'square', vol: 0.18 });
  },
  warn(s: Sound) {
    s.tone({ freq: 880, dur: 0.08, type: 'square', vol: 0.07 });
  },
  shieldLow(s: Sound) {
    s.tone({ freq: 440, to: 330, dur: 0.15, type: 'triangle', vol: 0.2 });
  },
  bomb(s: Sound) {
    s.noise({ dur: 1.4, freq: 6000, to: 60, vol: 0.6 });
    s.tone({ freq: 60, to: 30, dur: 1.2, type: 'sawtooth', vol: 0.2 });
  },
  sectorClear(s: Sound) {
    s.seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.15], [784, 0.1], [1047, 0.35]], { type: 'square', vol: 0.14 });
  },
  shipDown(s: Sound) {
    s.noise({ dur: 2.2, freq: 3000, to: 50, vol: 0.6 });
    s.tone({ freq: 400, to: 30, dur: 2, type: 'sawtooth', vol: 0.2 });
  },
};
