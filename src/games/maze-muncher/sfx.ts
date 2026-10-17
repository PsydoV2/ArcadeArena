import type { Sound } from '../../engine/sound';

export const sfx = {
  munch(s: Sound, alt: boolean) {
    s.tone(alt ? { freq: 260, to: 480, dur: 0.07, type: 'triangle', vol: 0.3 } : { freq: 480, to: 260, dur: 0.07, type: 'triangle', vol: 0.3 });
  },
  power(s: Sound) {
    s.tone({ freq: 200, to: 900, dur: 0.25, type: 'square', vol: 0.12 });
  },
  eatImp(s: Sound) {
    s.tone({ freq: 200, to: 1600, dur: 0.35, type: 'square', vol: 0.15 });
  },
  fruit(s: Sound) {
    s.seq([[880, 0.06], [1175, 0.06], [1760, 0.12]], { type: 'triangle', vol: 0.3 });
  },
  death(s: Sound) {
    s.tone({ freq: 800, to: 120, dur: 1.2, type: 'square', vol: 0.15 });
    s.noise({ dur: 0.4, freq: 1500, to: 200, vol: 0.2, delay: 1.2 });
  },
  extraLife(s: Sound) {
    s.seq([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], { type: 'square', vol: 0.15 });
  },
  start(s: Sound) {
    s.seq(
      [[392, 0.12], [523, 0.12], [659, 0.12], [523, 0.12], [587, 0.12], [698, 0.12], [880, 0.24], [784, 0.36]],
      { type: 'square', vol: 0.14 },
    );
    s.seq([[131, 0.36], [175, 0.36], [196, 0.24], [262, 0.36]], { type: 'triangle', vol: 0.3 });
  },
  levelClear(s: Sound) {
    s.seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]], { type: 'triangle', vol: 0.35 });
  },
};
