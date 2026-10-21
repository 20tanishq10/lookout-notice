import type { AgencyId } from '../shared/agencies';
import { DIRS, bearing, dist, type Dir } from '../shared/graph';
import { COUNTRIES, REGIONS, REGION_CODES, ZONES, isRegionCode, type RegionCode } from '../shared/regions';
import type { Rng } from '../shared/rng';
import { CBI_BANDS, type Clue, type ClueKind, type EdQuestion, type Metric, type PlayerId } from '../shared/types';

export interface ClueContext {
  /** Where he is now (after the night). */
  F: RegionCode;
  /** Where he was at the start of last night (= during the previous round). */
  nightStart: RegionCode;
  round: number;
  /** Every region he has stood in so far, path steps included. */
  visited: Set<RegionCode>;
  openGates: RegionCode[];
  /** All jeeps on the map (suspended ones included). */
  jeeps: Record<PlayerId, RegionCode | null>;
  distance: 'exact' | 'banded';
  rng: Rng;
}

export function cbiValue(d: number, mode: 'exact' | 'banded'): number | (typeof CBI_BANDS)[number] {
  if (mode === 'exact') return d;
  if (d === 0) return 'Here';
  if (d <= 2) return '1–2';
  if (d <= 4) return '3–4';
  return '5+';
}

/** `gatesInPlay` = every exit gate in this game, sealed or not (the `gate` question ignores sealing). */
export function evalEd(q: EdQuestion, F: RegionCode, jeep: RegionCode, gatesInPlay: RegionCode[]): boolean {
  const r = REGIONS[F];
  switch (q.q) {
    case 'coastal': return r.coastal;
    case 'borders': return r.foreign.includes(q.country);
    case 'zone': return r.zone === q.zone;
    case 'hindi': return r.hindiBelt;
    case 'seats': return r.seats >= q.n;
    case 'neighbours': return r.borders.length >= q.n;
    case 'gate': return gatesInPlay.includes(F);
    case 'sameZone': return r.zone === REGIONS[jeep].zone;
  }
}

function metricOf(c: RegionCode, m: Metric): number {
  return m === 'seats' ? REGIONS[c].seats : REGIONS[c].borders.length;
}

export function closestJeeps(F: RegionCode, jeeps: Record<PlayerId, RegionCode | null>): PlayerId[] {
  let best = Infinity;
  let ids: PlayerId[] = [];
  for (const [pid, j] of Object.entries(jeeps)) {
    if (!j) continue;
    const d = dist(j, F);
    if (d < best) {
      best = d;
      ids = [pid];
    } else if (d === best) ids.push(pid);
  }
  return ids.sort();
}

export function computeClue(
  agency: AgencyId,
  jeep: RegionCode,
  ctx: ClueContext & { allGates: RegionCode[]; edQuestion?: EdQuestion; itMetric?: Metric },
): Clue | null {
  const { F } = ctx;
  switch (agency) {
    case 'CBI':
      return { kind: 'CBI', value: cbiValue(dist(jeep, F), ctx.distance) };
    case 'NIA':
      return { kind: 'NIA', value: bearing(jeep, F) };
    case 'CYBER': {
      if (dist(jeep, F) > 3) return { kind: 'CYBER', value: 'No signal' };
      const pool = REGION_CODES.filter((c) => c !== F && dist(jeep, c) <= 3);
      const decoys = ctx.rng.shuffle(pool).slice(0, 2);
      return { kind: 'CYBER', value: ctx.rng.shuffle([F, ...decoys]) };
    }
    case 'POLICE':
      return { kind: 'POLICE', value: dist(jeep, F) <= 1 };
    case 'CRIME':
      return { kind: 'CRIME', value: jeep === F ? 'Now' : ctx.visited.has(jeep) ? 'Earlier' : 'Never' };
    case 'ED': {
      const question = ctx.edQuestion ?? { q: 'coastal' };
      return { kind: 'ED', question, value: evalEd(question, F, jeep, ctx.allGates) };
    }
    case 'IT': {
      const metric = ctx.itMetric ?? 'seats';
      const a = metricOf(F, metric);
      const b = metricOf(jeep, metric);
      return { kind: 'IT', metric, value: a > b ? 'More' : a < b ? 'Fewer' : 'Same' };
    }
    case 'CUSTOMS': {
      const ds = ctx.openGates.map((g) => dist(F, g));
      return { kind: 'CUSTOMS', value: ds.length ? Math.min(...ds) : 7 };
    }
    case 'RPF': {
      if (ctx.round === 1) return { kind: 'RPF', value: 'No movement yet' };
      const b = bearing(ctx.nightStart, F);
      return { kind: 'RPF', value: b === 'Here' ? 'Did not move' : b };
    }
    case 'RAW':
      return { kind: 'RAW', value: REGIONS[ctx.round === 1 ? F : ctx.nightStart].zone };
    case 'IB':
      return { kind: 'IB', value: closestJeeps(F, ctx.jeeps) };
    case 'MEDIA':
      return null;
  }
}

export const AGENCY_CLUE: Record<AgencyId, ClueKind | null> = {
  CBI: 'CBI', NIA: 'NIA', CYBER: 'CYBER', POLICE: 'POLICE', CRIME: 'CRIME', ED: 'ED', IT: 'IT',
  CUSTOMS: 'CUSTOMS', RPF: 'RPF', RAW: 'RAW', IB: 'IB', MEDIA: null,
};

function sortedCopy<T>(a: T[]): T[] {
  return [...a].sort();
}

export function sameEd(a: EdQuestion, b: EdQuestion): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Do two clues say exactly the same thing? (Order-insensitive for lists.) */
export function sameClue(a: Clue, b: Clue): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'CYBER': {
      const bv = (b as typeof a).value;
      if (a.value === 'No signal' || bv === 'No signal') return a.value === bv;
      return JSON.stringify(sortedCopy(a.value)) === JSON.stringify(sortedCopy(bv));
    }
    case 'IB':
      return JSON.stringify(sortedCopy(a.value)) === JSON.stringify(sortedCopy((b as typeof a).value));
    case 'ED':
      return sameEd(a.question, (b as typeof a).question) && a.value === (b as typeof a).value;
    case 'IT':
      return a.metric === (b as typeof a).metric && a.value === (b as typeof a).value;
    default:
      return (a as { value: unknown }).value === (b as { value: unknown }).value;
  }
}

const isDir = (v: unknown): v is Dir => typeof v === 'string' && (DIRS as readonly string[]).includes(v);

export function validEdQuestion(q: unknown): q is EdQuestion {
  if (!q || typeof q !== 'object') return false;
  const o = q as Record<string, unknown>;
  switch (o.q) {
    case 'coastal': case 'hindi': case 'gate': case 'sameZone':
      return true;
    case 'borders':
      return typeof o.country === 'string' && (COUNTRIES as readonly string[]).includes(o.country);
    case 'zone':
      return typeof o.zone === 'string' && (ZONES as readonly string[]).includes(o.zone);
    case 'seats':
      return typeof o.n === 'number' && Number.isInteger(o.n) && o.n >= 1 && o.n <= 80;
    case 'neighbours':
      return typeof o.n === 'number' && Number.isInteger(o.n) && o.n >= 1 && o.n <= 8;
    default:
      return false;
  }
}

/** Shape check for any clue (used for Press Releases and leaks). Returns a cleaned copy or null. */
export function cleanClue(raw: unknown, players: PlayerId[], distance: 'exact' | 'banded'): Clue | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const v = c.value;
  switch (c.kind) {
    case 'CBI':
      if (distance === 'exact') return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7 ? { kind: 'CBI', value: v } : null;
      return typeof v === 'string' && (CBI_BANDS as string[]).includes(v) ? { kind: 'CBI', value: v as (typeof CBI_BANDS)[number] } : null;
    case 'NIA':
      return v === 'Here' || isDir(v) ? { kind: 'NIA', value: v } : null;
    case 'CYBER': {
      if (v === 'No signal') return { kind: 'CYBER', value: 'No signal' };
      if (!Array.isArray(v) || v.length < 1 || v.length > 3 || !v.every(isRegionCode)) return null;
      if (new Set(v).size !== v.length) return null;
      return { kind: 'CYBER', value: [...v] };
    }
    case 'POLICE':
      return typeof v === 'boolean' ? { kind: 'POLICE', value: v } : null;
    case 'CRIME':
      return v === 'Now' || v === 'Earlier' || v === 'Never' ? { kind: 'CRIME', value: v } : null;
    case 'ED':
      return validEdQuestion(c.question) && typeof v === 'boolean' ? { kind: 'ED', question: c.question, value: v } : null;
    case 'IT':
      return (c.metric === 'seats' || c.metric === 'neighbours') && (v === 'More' || v === 'Fewer' || v === 'Same')
        ? { kind: 'IT', metric: c.metric, value: v }
        : null;
    case 'CUSTOMS':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7 ? { kind: 'CUSTOMS', value: v } : null;
    case 'RPF':
      return v === 'Did not move' || v === 'No movement yet' || isDir(v) ? { kind: 'RPF', value: v } : null;
    case 'RAW':
      return typeof v === 'string' && (ZONES as readonly string[]).includes(v) ? { kind: 'RAW', value: v as (typeof ZONES)[number] } : null;
    case 'IB': {
      if (!Array.isArray(v) || v.length < 1 || v.length > players.length) return null;
      if (!v.every((x) => typeof x === 'string' && players.includes(x)) || new Set(v).size !== v.length) return null;
      return { kind: 'IB', value: [...v] as PlayerId[] };
    }
    default:
      return null;
  }
}

/**
 * Extra rules for a Planted Leak on top of the shape check: it must be a value the target's clue could
 * really produce, and it can't fake a Hot Trail. Returns an error message or null if fine.
 */
export function leakProblem(fake: Clue, truth: Clue, targetJeep: RegionCode | null): string | null {
  if (fake.kind !== truth.kind) return "The fake has to use the target's clue format.";
  switch (fake.kind) {
    case 'CBI':
      if (fake.value === 0 || fake.value === 'Here') return "A leak can't fake a Hot Trail.";
      return null;
    case 'NIA':
      return fake.value === 'Here' ? "A leak can't fake a Hot Trail." : null;
    case 'CRIME':
      return fake.value === 'Now' ? "A leak can't fake a Hot Trail." : null;
    case 'CYBER': {
      if (fake.value === 'No signal' || targetJeep === null) return null;
      const pool = REGION_CODES.filter((c) => dist(targetJeep, c) <= 3);
      const need = Math.min(3, pool.length);
      if (fake.value.length !== need) return `A tower ping lists ${need} regions.`;
      if (!fake.value.every((c) => pool.includes(c))) return 'Every pinged region must be within 3 borders of their jeep.';
      return null;
    }
    case 'ED':
      return sameEd(fake.question, (truth as typeof fake).question) ? null : 'An ED leak keeps the question they asked.';
    case 'IT':
      return fake.metric === (truth as typeof fake).metric ? null : 'An Income Tax leak keeps the comparison they chose.';
    case 'RPF':
      return fake.value === 'No movement yet' ? 'Not a possible answer after Round 1.' : null;
    default:
      return null;
  }
}
