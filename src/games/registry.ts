import type { CabinetInfo } from '../engine/types';
import { brickBlaster } from './brick-blaster';
import { cosmicSiege } from './cosmic-siege';
import { mazeMuncher } from './maze-muncher';
import { starRun } from './star-run';

/** Reihenfolge der Automaten in der Halle. Neue Spiele hier eintragen. */
export const CABINETS: CabinetInfo[] = [cosmicSiege, mazeMuncher, starRun, brickBlaster];
