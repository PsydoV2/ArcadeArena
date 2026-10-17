export interface ToneOpts {
  freq: number;
  /** Zielfrequenz für einen Pitch-Slide. */
  to?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  delay?: number;
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

const MUTE_KEY = 'arcadearena.muted';

/** Synthetisierte Chiptune-Effekte über WebAudio, keine Audiodateien. */
export class Sound {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
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
      const master = ac.createGain();
      master.gain.value = 0.2;
      master.connect(ac.destination);
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
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = o.type ?? 'square';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
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

  private begin(delay = 0) {
    if (!this.ac || !this.master || this.muted) return null;
    return { ac: this.ac, out: this.master, t: this.ac.currentTime + delay };
  }
}
