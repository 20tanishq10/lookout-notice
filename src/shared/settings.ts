import { AGENCY_IDS, FILTERS, LOCATORS, type AgencyId } from './agencies';

export type TimerPreset = 'short' | 'standard' | 'long';

export interface Settings {
  agencies: AgencyId[];
  rounds: 5 | 6 | 7;
  timers: TimerPreset;
  distance: 'exact' | 'banded';
  mantris: 1 | 2;
  leaks: 0 | 1 | 2;
  hawala: 0 | 1 | 2 | 3;
  suitcase: boolean;
  gates: 5 | 6 | 7;
  circulars: 2 | 3 | 4;
  earliestEscape: 3 | 4 | 5;
  stings: 1 | 2 | 3;
  news: boolean;
  hiddenAgencies: boolean;
}

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 8;

/** Phase lengths in seconds. Night and Briefing are fixed so the wait gives nothing away. */
export const TIMERS: Record<TimerPreset, Record<'night' | 'deploy' | 'briefing' | 'press' | 'talk' | 'action' | 'inquiry', number>> = {
  short: { night: 10, deploy: 20, briefing: 10, press: 15, talk: 60, action: 20, inquiry: 60 },
  standard: { night: 10, deploy: 25, briefing: 10, press: 20, talk: 90, action: 25, inquiry: 60 },
  long: { night: 10, deploy: 35, briefing: 10, press: 30, talk: 120, action: 35, inquiry: 60 },
};

export function suggestedAgencies(players: number): AgencyId[] {
  const base: AgencyId[] = ['CBI', 'NIA', 'ED', 'POLICE', 'MEDIA', 'IB', 'CUSTOMS', 'CRIME'];
  return base.slice(0, Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players)));
}

export function defaultSettings(players = MIN_PLAYERS): Settings {
  return {
    agencies: suggestedAgencies(players),
    rounds: 6,
    timers: 'standard',
    distance: 'exact',
    mantris: 1,
    leaks: 2,
    hawala: 2,
    suitcase: true,
    gates: 6,
    circulars: 3,
    earliestEscape: 4,
    stings: 2,
    news: true,
    hiddenAgencies: false,
  };
}

export const PRESETS: { id: string; name: string; desc: string; patch: (s: Settings, players: number) => Partial<Settings> }[] = [
  {
    id: 'training',
    name: 'Training',
    desc: 'No Planted Leaks, Suitcase or Breaking News. Long timers.',
    patch: () => ({ leaks: 0, suitcase: false, news: false, timers: 'long', mantris: 1, hawala: 2, hiddenAgencies: false, rounds: 6, earliestEscape: 4 }),
  },
  {
    id: 'classic',
    name: 'Classic',
    desc: 'The default rules.',
    patch: (_s, players) => {
      const d = defaultSettings(players);
      const { agencies: _a, ...rest } = d;
      return rest;
    },
  },
  {
    id: 'paranoia',
    name: 'Paranoia',
    desc: '2 Mantris at 7–8 players, 3 Hawala moves, hidden agencies.',
    patch: (_s, players) => ({ mantris: players >= 7 ? 2 : 1, hawala: 3, leaks: 2, suitcase: true, hiddenAgencies: true }),
  },
  {
    id: 'blitz',
    name: 'Blitz',
    desc: '5 rounds, short timers, escape from Round 3.',
    patch: () => ({ rounds: 5, timers: 'short', earliestEscape: 3 }),
  },
];

export interface SettingsCheck {
  errors: string[];
  warnings: string[];
}

export function checkSettings(s: Settings, players: number): SettingsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (players < MIN_PLAYERS) errors.push(`Need at least ${MIN_PLAYERS} players (have ${players}).`);
  if (players > MAX_PLAYERS) errors.push(`At most ${MAX_PLAYERS} players.`);
  if (new Set(s.agencies).size !== s.agencies.length) errors.push('Each agency can only be picked once.');
  if (s.agencies.length !== players) errors.push(`Pick exactly one agency per player (${s.agencies.length} picked, ${players} players).`);
  if (s.mantris === 2 && players < 7) errors.push('Two Mantris need 7 or 8 players.');
  const locators = s.agencies.filter((a) => LOCATORS.includes(a)).length;
  if (locators < 2) warnings.push('Fewer than 2 Locator agencies (CBI, NIA, Cyber Cell): the hunt gets very hard to solve.');
  if (!s.agencies.some((a) => FILTERS.includes(a))) warnings.push('No Filter agency (ED, Income Tax) in play.');
  if (!s.agencies.includes('MEDIA')) warnings.push('No Media: there will be no Stings this game.');
  return { errors, warnings };
}

/**
 * Rough balance estimate from 0 (agencies favoured) to 100 (Mantri favoured); 50 is even.
 * Placeholder until the bot simulator tunes it.
 */
export function balanceEstimate(s: Settings): number {
  let v = 50;
  for (const a of s.agencies) {
    if (LOCATORS.includes(a)) v -= 4;
    else if (a === 'POLICE' || a === 'CRIME' || a === 'ED' || a === 'IT') v -= 2.5;
    else if (a !== 'MEDIA') v -= 1.5;
  }
  v += 1; // calibrated so the Classic 5-player setup reads as roughly even
  v += s.leaks * 3 + s.hawala * 1.5 + (s.suitcase ? 3 : 0) + (s.mantris === 2 ? 8 : 0);
  v += (s.gates - 6) * 4 - (s.circulars - 3) * 4 - (s.earliestEscape - 4) * 4;
  v += s.distance === 'banded' ? 6 : 0;
  v -= (s.rounds - 6) * 2;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function isAgencyId(x: unknown): x is AgencyId {
  return typeof x === 'string' && (AGENCY_IDS as readonly string[]).includes(x);
}

/** Validate and clamp an untrusted settings patch from the host. */
export function sanitizeSettings(base: Settings, patch: unknown): Settings {
  const p = (patch ?? {}) as Record<string, unknown>;
  const out: Settings = { ...base };
  const pickNum = <T extends number>(k: keyof Settings, allowed: readonly T[]) => {
    const v = p[k];
    if (typeof v === 'number' && (allowed as readonly number[]).includes(v)) (out as unknown as Record<string, unknown>)[k] = v;
  };
  const pickBool = (k: keyof Settings) => {
    if (typeof p[k] === 'boolean') (out as unknown as Record<string, unknown>)[k] = p[k];
  };
  if (Array.isArray(p.agencies)) {
    const list = p.agencies.filter(isAgencyId);
    out.agencies = [...new Set(list)].slice(0, MAX_PLAYERS);
  }
  pickNum('rounds', [5, 6, 7] as const);
  if (p.timers === 'short' || p.timers === 'standard' || p.timers === 'long') out.timers = p.timers;
  if (p.distance === 'exact' || p.distance === 'banded') out.distance = p.distance;
  pickNum('mantris', [1, 2] as const);
  pickNum('leaks', [0, 1, 2] as const);
  pickNum('hawala', [0, 1, 2, 3] as const);
  pickBool('suitcase');
  pickNum('gates', [5, 6, 7] as const);
  pickNum('circulars', [2, 3, 4] as const);
  pickNum('earliestEscape', [3, 4, 5] as const);
  pickNum('stings', [1, 2, 3] as const);
  pickBool('news');
  pickBool('hiddenAgencies');
  return out;
}
