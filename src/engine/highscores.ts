export interface ScoreEntry {
  name: string;
  score: number;
}

const MAX_ENTRIES = 10;
const INITIALS_KEY = 'arcadearena.initials';

/**
 * Frühere Vorbelegung der Tafeln. Sie steht nicht mehr auf neuen Tafeln, wird aber noch
 * aus bereits gespeicherten Tafeln entfernt, damit dort nur eigene Ergebnisse bleiben.
 */
const OLD_DEFAULTS: ScoreEntry[] = [
  ['ACE', 5000], ['BOB', 4000], ['CAT', 3000], ['DAN', 2500], ['EVE', 2000],
  ['FOX', 1500], ['GUS', 1000], ['HAL', 800], ['IVY', 600], ['JOE', 400],
].map(([name, score]) => ({ name: name as string, score: score as number }));

function isEntry(e: unknown): e is ScoreEntry {
  return (
    typeof e === 'object' && e !== null &&
    typeof (e as ScoreEntry).name === 'string' &&
    typeof (e as ScoreEntry).score === 'number'
  );
}

/** Top-10-Tafel eines Automaten, gespeichert in localStorage. */
export class ScoreBoard {
  private entries: ScoreEntry[];

  constructor(readonly gameId: string) {
    this.entries = this.load();
  }

  list(): readonly ScoreEntry[] {
    return this.entries;
  }

  best(): number {
    return this.entries[0]?.score ?? 0;
  }

  /** Platz (0-basiert), den dieser Punktestand bekäme, oder -1. */
  rankOf(score: number): number {
    if (score <= 0) return -1;
    const i = this.entries.findIndex((e) => score > e.score);
    if (i >= 0) return i;
    return this.entries.length < MAX_ENTRIES ? this.entries.length : -1;
  }

  /** Trägt ein und liefert den Platz (0-basiert) oder -1. */
  add(name: string, score: number): number {
    const rank = this.rankOf(score);
    if (rank < 0) return -1;
    this.entries.splice(rank, 0, { name, score });
    this.entries.length = Math.min(this.entries.length, MAX_ENTRIES);
    try {
      localStorage.setItem(this.key, JSON.stringify(this.entries));
    } catch {
      // Speichern nicht möglich → Tafel gilt nur für diese Sitzung
    }
    return rank;
  }

  private get key() {
    return `arcadearena.scores.${this.gameId}`;
  }

  private load(): ScoreEntry[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const data: unknown = JSON.parse(raw);
        if (Array.isArray(data)) {
          return data
            .filter(isEntry)
            .filter((e) => !OLD_DEFAULTS.some((d) => d.name === e.name && d.score === e.score))
            .slice(0, MAX_ENTRIES);
        }
      }
    } catch {
      // kaputte oder fehlende Daten → leere Tafel
    }
    return [];
  }
}

/** Zuletzt eingegebene Initialen, damit man sie nicht jedes Mal neu tippen muss. */
export function lastInitials(): string {
  try {
    const v = localStorage.getItem(INITIALS_KEY);
    if (v && /^[A-Z]{3}$/.test(v)) return v;
  } catch {
    // ignorieren
  }
  return 'AAA';
}

export function saveInitials(name: string): void {
  try {
    localStorage.setItem(INITIALS_KEY, name);
  } catch {
    // ignorieren
  }
}
