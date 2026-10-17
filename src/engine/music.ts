import type { Sound } from './sound';

/** Wie ein Jahrzehnt klingt: Schlagzeugmuster (16 Schritte pro Takt) und Instrumente. */
export interface MusicStyle {
  kick: string;
  snare: string;
  hat: string;
  open: string;
  clap: string;
  /** Snare-Ausklang in Sekunden (die großen 80er-Snares klingen lange nach). */
  snareTail: number;
  bass: 'octave' | 'funk' | 'pulse' | 'offbeat';
  keys: 'strings' | 'pad' | 'stab';
  lead: OscillatorType;
  /** Arpeggio auch in Strophe und Refrain, nicht nur im Break. */
  arp: boolean;
}

/** Eine Schallplatte: eigene Komposition, die nach ihrem Jahrzehnt klingt. */
export interface MusicRecord {
  title: string;
  era: string;
  color: string;
  bpm: number;
  /** Verzögerung jeder zweiten Sechzehntel (Anteil eines Schritts) für Groove. */
  swing?: number;
  style: MusicStyle;
  /** Ein Akkord pro Takt, wird wiederholt. */
  chords: string[];
  /** Melodie, ein Takt pro Eintrag: 16 Schritte, "." Pause, "-" Ton halten. */
  lead: string[];
  /** Ablauf, ein Buchstabe pro Melodie-Durchgang: I Intro, V Strophe, C Refrain, B Break. */
  form: string;
}

/** Lautstärke in der Halle bzw. gedämpft während eines Spiels (wie aus dem Nebenraum). */
const HALL = { vol: 0.09, cutoff: 9000 };
const MUFFLED = { vol: 0.035, cutoff: 360 };
const LOOKAHEAD = 0.15;

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
};
const BASS_LINES: Record<MusicStyle['bass'], (number | null)[]> = {
  octave: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, null],
  funk: [0, null, null, 12, null, 0, null, 10, 12, null, 7, null, 0, null, 10, 12],
  pulse: [0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 7, null],
  offbeat: [null, null, 0, null, null, null, 0, null, null, null, 0, null, null, null, 0, 12],
};
const STAB = 'x..x..x...x..x..';
const SECTION_LAYERS: Record<string, string> = {
  I: 'kick hat open bass',
  V: 'kick snare clap hat open bass keys',
  C: 'kick snare clap hat open bass keys lead',
  B: 'hat keys arp roll',
};

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function noteNumber(token: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(token);
  if (!m) throw new Error(`Unbekannte Note ${token}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Akkord → Grundton (A1 … G#2) und Töne für die Begleitung (ab A3). */
function chordNotes(name: string): { root: number; tones: number[] } {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const quality = m && QUALITY[m[2]];
  if (!m || !quality) throw new Error(`Unbekannter Akkord ${name}`);
  const pc = (noteNumber(`${m[1]}0`) - 12 + 12) % 12;
  const root = 57 + ((pc - 9 + 12) % 12);
  return { root: root - 24, tones: quality.map((i) => root + i) };
}

/** Plattenspieler: spielt die Platten nacheinander und mischt sich je nach Ort lauter oder gedämpft ab. */
export class Music {
  playing = false;
  index = 0;

  private ac: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private filter: BiquadFilterNode | null = null;
  private out: GainNode | null = null;
  private echo: GainNode | null = null;
  private echoDelay: DelayNode | null = null;
  /** Jede Platte bekommt einen eigenen Eingang, damit beim Wechsel nichts nachklingt. */
  private deck: GainNode | null = null;
  private muffled = false;
  private mix = '';

  private pos = 0;
  private stepAt = 0;
  private t0 = 0;
  private bars: { chord: ReturnType<typeof chordNotes>; lead: string[]; section: string }[] = [];

  constructor(
    private sound: Sound,
    readonly records: MusicRecord[],
  ) {}

  get current(): MusicRecord {
    return this.records[this.index];
  }

  /** Position in Viertelnoten seit Beginn der Platte (für Lautsprecher und Drehteller). */
  get beat(): number {
    if (!this.playing || !this.ac) return 0;
    return Math.max(0, (this.ac.currentTime - this.t0) / (60 / this.current.bpm));
  }

  play(index = this.index): void {
    this.index = (index + this.records.length) % this.records.length;
    this.playing = true;
    this.load(true);
  }

  next(): void {
    this.play(this.index + 1);
  }

  stop(): void {
    this.playing = false;
    this.dropDeck();
  }

  /** Während eines Spiels leise und dumpf, in der Halle offen. */
  setMuffled(on: boolean): void {
    this.muffled = on;
  }

  /** Einmal pro Tick aus der Hauptschleife: Noten kurz im Voraus einplanen. */
  update(): void {
    if (!this.ensureBus() || !this.ac) return;
    const now = this.ac.currentTime;
    this.applyMix(now);
    if (!this.playing) return;
    if (!this.deck) this.load(true);
    const stepDur = 60 / this.current.bpm / 4;
    // Nach einem Tab-Wechsel nicht alles auf einmal nachholen, sondern einfach weiterspielen
    if (this.stepAt < now - 0.1) {
      this.stepAt = now + 0.05;
      this.t0 = this.stepAt - this.pos * stepDur;
    }
    while (this.playing && this.stepAt < now + LOOKAHEAD) {
      if (this.pos >= this.bars.length * 16) {
        // Platte zu Ende: kurze Pause, dann die nächste
        this.index = (this.index + 1) % this.records.length;
        this.load(false);
        continue;
      }
      this.step(this.stepAt, this.pos);
      this.pos++;
      this.stepAt += 60 / this.current.bpm / 4;
    }
  }

  private ensureBus(): boolean {
    if (this.out) return true;
    const graph = this.sound.graph;
    if (!graph) return false;
    const { ac, out, noise } = graph;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = HALL.cutoff;
    filter.Q.value = 0.9;
    const gain = ac.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(out);
    // Etwas Echo für den Raumklang der Halle (nur Melodie und Arpeggio)
    const echo = ac.createGain();
    const delay = ac.createDelay(1);
    const feedback = ac.createGain();
    feedback.gain.value = 0.3;
    const wet = ac.createGain();
    wet.gain.value = 0.35;
    echo.connect(delay).connect(feedback).connect(delay);
    delay.connect(wet).connect(filter);
    this.ac = ac;
    this.noise = noise;
    this.filter = filter;
    this.out = gain;
    this.echo = echo;
    this.echoDelay = delay;
    return true;
  }

  private applyMix(now: number) {
    const level = this.muffled ? MUFFLED : HALL;
    const vol = this.playing && !this.sound.muted ? level.vol : 0;
    const key = `${vol}/${level.cutoff}`;
    if (key === this.mix) return;
    this.mix = key;
    this.out!.gain.setTargetAtTime(vol, now, 0.25);
    this.filter!.frequency.setTargetAtTime(level.cutoff, now, 0.25);
  }

  /** Platte auflegen: Takte vorbereiten, eigenen Eingang anlegen. */
  private load(immediate: boolean) {
    const rec = this.current;
    this.bars = [];
    for (const section of rec.form) {
      rec.lead.forEach((bar, i) => {
        const lead = bar.trim().split(/\s+/);
        if (lead.length !== 16) throw new Error(`${rec.title}: Takt ${i + 1} hat ${lead.length} Schritte`);
        this.bars.push({ chord: chordNotes(rec.chords[i % rec.chords.length]), lead, section });
      });
    }
    this.pos = 0;
    if (!this.ensureBus() || !this.ac) return;
    // Beim Umschalten verstummt die alte Platte sofort, am Plattenende klingt sie aus
    if (immediate || !this.deck) {
      this.dropDeck();
      this.deck = this.ac.createGain();
      this.deck.connect(this.filter!);
    }
    const stepDur = 60 / rec.bpm / 4;
    this.echoDelay!.delayTime.value = stepDur * 3;
    // Zwischen zwei Platten ein Takt Stille, wie beim Plattenwechsel
    const now = this.ac.currentTime;
    this.stepAt = immediate ? now + 0.08 : Math.max(this.stepAt, now) + stepDur * 16;
    this.t0 = this.stepAt;
    this.crackle(this.stepAt - (immediate ? 0.05 : 0.6));
  }

  private dropDeck() {
    const deck = this.deck;
    this.deck = null;
    if (!deck || !this.ac) return;
    deck.gain.setTargetAtTime(0, this.ac.currentTime, 0.03);
    setTimeout(() => deck.disconnect(), 500);
  }

  private step(t: number, pos: number) {
    const rec = this.current;
    const st = rec.style;
    const s = pos % 16;
    const barIdx = Math.floor(pos / 16);
    const bar = this.bars[barIdx];
    const layers = SECTION_LAYERS[bar.section] ?? SECTION_LAYERS.C;
    const has = (l: string) => layers.includes(l);
    const stepDur = 60 / rec.bpm / 4;
    if (s % 2 === 1 && rec.swing) t += rec.swing * stepDur;
    const hit = (pattern: string) => pattern[s] === 'x';

    if (has('kick') && hit(st.kick)) this.kick(t);
    if (has('snare') && hit(st.snare)) this.snare(t, st.snareTail, 0.5);
    if (has('clap') && hit(st.clap)) this.clap(t);
    if (has('hat') && hit(st.hat)) this.hat(t, 0.04, s % 4 === 0 ? 0.16 : 0.1);
    if (has('open') && hit(st.open)) this.hat(t, 0.22, 0.12);
    // Trommelwirbel im letzten Takt des Breaks, dann geht es wieder los
    const lastOfSection = (barIdx + 1) % this.sectionBars === 0;
    if (has('roll') && lastOfSection && (s >= 8 || s % 2 === 0)) this.snare(t, 0.1, 0.12 + s * 0.025);

    const { root, tones } = bar.chord;
    const bass = BASS_LINES[st.bass][s];
    if (has('bass') && bass !== null) this.bass(t, root + bass, stepDur * 1.6);

    if (has('keys')) {
      if (st.keys === 'stab') {
        if (STAB[s] === 'x') this.chord(t, tones, stepDur * 1.5, 'stab');
      } else if (s === 0) {
        this.chord(t, tones, stepDur * 16, st.keys);
      }
    }
    // Im Break laufen Sechzehntel durch den Akkord, sonst (falls der Stil es will) leise Achtel
    const arpBreak = has('arp');
    if (arpBreak || (st.arp && has('keys') && s % 2 === 0)) {
      const i = arpBreak ? s : s / 2;
      const n = tones[i % tones.length] + 12 * (1 + (Math.floor(i / tones.length) % 2));
      this.voice(t, midi(n), stepDur * 0.9, 'square', arpBreak ? 0.05 : 0.03, 2400, true);
    }

    if (has('lead')) {
      const token = bar.lead[s];
      if (token !== '.' && token !== '-') {
        let len = 1;
        while (s + len < 16 && bar.lead[s + len] === '-') len++;
        this.voice(t, midi(noteNumber(token)), stepDur * len * 0.95, st.lead, 0.11, 3200, true);
      }
    }
  }

  private get sectionBars() {
    return this.current.lead.length;
  }

  // ---------- Instrumente ----------

  private env(t: number, peak: number, attack: number, dur: number, release = 0.05): GainNode {
    const gain = this.ac!.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    gain.connect(this.deck!);
    return gain;
  }

  private noiseSrc(t: number, dur: number, type: BiquadFilterType, freq: number, out: AudioNode) {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    src.connect(filter).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const gain = this.env(t, 0.9, 0.002, 0.08, 0.2);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  private snare(t: number, tail: number, vol: number) {
    this.noiseSrc(t, tail + 0.05, 'highpass', 1500, this.env(t, vol, 0.002, 0.01, tail));
    const osc = this.ac!.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    osc.connect(this.env(t, vol * 0.6, 0.002, 0.01, 0.08));
    osc.start(t);
    osc.stop(t + 0.15);
  }

  private clap(t: number) {
    // Drei schnelle Rauschstöße, wie viele Hände
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.011;
      this.noiseSrc(at, i === 2 ? 0.16 : 0.012, 'bandpass', 1300, this.env(at, 0.4, 0.001, 0.005, i === 2 ? 0.14 : 0.01));
    }
  }

  private hat(t: number, dur: number, vol: number) {
    this.noiseSrc(t, dur, 'highpass', 7500, this.env(t, vol, 0.001, 0.005, dur));
  }

  private bass(t: number, note: number, dur: number) {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midi(note);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(260, t + dur);
    osc.connect(filter).connect(this.env(t, 0.32, 0.004, dur, 0.04));
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private chord(t: number, tones: number[], dur: number, kind: MusicStyle['keys']) {
    const ac = this.ac!;
    const soft = kind !== 'stab';
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(soft ? 2200 : 4200, t);
    if (!soft) filter.frequency.exponentialRampToValueAtTime(900, t + dur);
    const peak = kind === 'stab' ? 0.07 : kind === 'strings' ? 0.035 : 0.04;
    const attack = kind === 'strings' ? 0.25 : kind === 'pad' ? 0.06 : 0.004;
    filter.connect(this.env(t, peak, attack, dur, soft ? 0.3 : 0.06));
    for (const n of tones) {
      // Zwei leicht verstimmte Oszillatoren pro Ton klingen breiter
      for (const detune of [-8, 8]) {
        const osc = ac.createOscillator();
        osc.type = kind === 'pad' ? 'square' : 'sawtooth';
        osc.frequency.value = midi(n + (kind === 'stab' ? 12 : 0));
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur + 0.4);
      }
    }
  }

  private voice(t: number, freq: number, dur: number, type: OscillatorType, vol: number, cutoff: number, echo: boolean) {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    // Leichtes Vibrato bei langen Tönen
    if (dur > 0.3) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ac.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(12, t + dur);
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.env(t, vol, 0.008, dur, 0.06);
    osc.connect(filter).connect(gain);
    if (echo) gain.connect(this.echo!);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  /** Knistern, wenn die Nadel aufsetzt. */
  private crackle(t: number) {
    if (!this.deck) return;
    t = Math.max(t, this.ac!.currentTime);
    for (let i = 0; i < 6; i++) {
      const at = t + Math.random() * 0.5;
      this.noiseSrc(at, 0.01, 'highpass', 3000, this.env(at, 0.06 + Math.random() * 0.08, 0.001, 0.002, 0.008));
    }
  }
}
