import type { Sound } from './sound';

/** Gemeinsame Effekte für Halle und Automaten-Rahmen. */
export const sfx = {
  coin(s: Sound) {
    s.seq([[988, 0.07], [1319, 0.35]], { type: 'square', vol: 0.18 });
  },
  blip(s: Sound) {
    s.tone({ freq: 660, dur: 0.05, type: 'square', vol: 0.12 });
  },
  confirm(s: Sound) {
    s.seq([[660, 0.05], [990, 0.09]], { type: 'square', vol: 0.15 });
  },
  buzz(s: Sound) {
    s.tone({ freq: 110, dur: 0.25, type: 'sawtooth', vol: 0.2 });
  },
  fanfare(s: Sound) {
    s.seq(
      [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.2], [784, 0.1], [1047, 0.4]],
      { type: 'square', vol: 0.16 },
    );
  },
};
