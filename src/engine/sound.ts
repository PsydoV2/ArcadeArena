export interface ToneOpts {
  freq: number;
  /** Zielfrequenz für einen Pitch-Slide. */
  to?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  delay?: number;
  /** Zufällige Tonhöhen-Abweichung (z. B. 0.05 = ±5 %), damit Wiederholungen nicht nerven. */
  jitter?: number;
}

export interface NoiseOpts {
  dur: number;
  /** Tiefpass-Grenzfrequenz zu Beginn … */
  freq?: number;
  /** … und am Ende. */
  to?: number;
  vol?: number;
  delay?: number;
}

export interface LoopOpts {
  /** Rauschen statt Oszillator (dann ist `freq` die Tiefpass-Grenzfrequenz). */
  noise?: boolean;
  type?: OscillatorType;
  freq: number;
  vol?: number;
  /** Tonhöhen-Modulation, z. B. für Sirenen. */
  lfo?: { rate: number; depth: number };
}

/** Steuerung eines laufenden Endlos-Sounds. */
export interface LoopHandle {
  readonly alive: boolean;
  set(freq: number, vol?: number): void;
  stop(): void;
}

export const DEAD_LOOP: LoopHandle = { alive: false, set() {}, stop() {} };
const MUTE_KEY = 'arcadearena.muted';

/** Synthetisierte Chiptune-Effekte über WebAudio, keine Audiodateien. */
export class Sound {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private loops = new Set<LoopHandle>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Speicher nicht verfügbar → Standard behalten
    }
  }

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (Autoplay-Regeln der Browser). */
  unlock(): void {
    if (!this.ac) {
      const ac = new AudioContext();
      // Kompressor fängt Spitzen ab, wenn viele Effekte gleichzeitig spielen
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.connect(ac.destination);
      const master = ac.createGain();
      master.gain.value = 0.22;
      master.connect(comp);
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ac = ac;
      this.master = master;
      this.noiseBuf = buf;
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) this.stopLoops();
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // ignorieren
    }
    return this.muted;
  }

  tone(o: ToneOpts): void {
    const s = this.begin(o.delay);
    if (!s) return;
    const { ac, t, out } = s;
    const j = o.jitter ? 1 + (Math.random() * 2 - 1) * o.jitter : 1;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = o.type ?? 'square';
    osc.frequency.setValueAtTime(o.freq * j, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * j, t + o.dur);
    gain.gain.setValueAtTime(o.vol ?? 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  noise(o: NoiseOpts): void {
    const s = this.begin(o.delay);
    if (!s || !this.noiseBuf) return;
    const { ac, t, out } = s;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(o.freq ?? 4000, t);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(o.vol ?? 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + o.dur + 0.05);
  }

  /** Kurze Melodie aus [Frequenz, Dauer]-Paaren. */
  seq(notes: [number, number][], o: Omit<ToneOpts, 'freq' | 'dur'> = {}): void {
    let delay = o.delay ?? 0;
    for (const [freq, dur] of notes) {
      this.tone({ ...o, freq, dur, delay });
      delay += dur;
    }
  }

  /**
   * Startet einen Endlos-Sound (Sirene, Triebwerk, Raumklang).
   * Ohne Audio oder bei Stummschaltung kommt ein Handle mit alive = false zurück.
   */
  loop(o: LoopOpts): LoopHandle {
    const s = this.begin();
    if (!s || !this.noiseBuf) return DEAD_LOOP;
    const { ac, t, out } = s;
    const vol = o.vol ?? 0.1;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.15);
    gain.connect(out);

    const sources: AudioScheduledSourceNode[] = [];
    let tuned: AudioParam;
    if (o.noise) {
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.freq;
      src.connect(filter).connect(gain);
      sources.push(src);
      tuned = filter.frequency;
    } else {
      const osc = ac.createOscillator();
      osc.type = o.type ?? 'sine';
      osc.frequency.value = o.freq;
      osc.connect(gain);
      sources.push(osc);
      tuned = osc.frequency;
      if (o.lfo) {
        const lfo = ac.createOscillator();
        lfo.frequency.value = o.lfo.rate;
        const depth = ac.createGain();
        depth.gain.value = o.lfo.depth;
        lfo.connect(depth).connect(osc.frequency);
        sources.push(lfo);
      }
    }
    for (const src of sources) src.start(t);

    const loops = this.loops;
    const handle: LoopHandle = {
      alive: true,
      set(freq, v) {
        const now = ac.currentTime;
        tuned.setTargetAtTime(freq, now, 0.05);
        if (v !== undefined) gain.gain.setTargetAtTime(Math.max(0.0001, v), now, 0.05);
      },
      stop() {
        if (!handle.alive) return;
        (handle as { alive: boolean }).alive = false;
        loops.delete(handle);
        const now = ac.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.03);
        for (const src of sources) src.stop(now + 0.2);
      },
    };
    loops.add(handle);
    return handle;
  }

  /** Beendet alle Endlos-Sounds (Szenenwechsel, Pause, Game Over). */
  stopLoops(): void {
    for (const h of [...this.loops]) h.stop();
  }

  private begin(delay = 0) {
    if (!this.ac || !this.master || this.muted) return null;
    return { ac: this.ac, out: this.master, t: this.ac.currentTime + delay };
  }
}
