import { describe, expect, it } from 'vitest';
import { AGENCY_IDS, type AgencyId } from '../src/shared/agencies';
import { botActions } from '../src/engine/bot';
import { Game } from '../src/engine/game';
import { DIST, bearing, dist } from '../src/shared/graph';
import { BORDER_PAIRS, REGIONS, REGION_CODES, gatesFor, type RegionCode } from '../src/shared/regions';
import { Rng } from '../src/shared/rng';
import { defaultSettings, suggestedAgencies, type Settings } from '../src/shared/settings';
import type { GameView } from '../src/shared/types';

function setup(n: number, patch: Partial<Settings> = {}, seed = 7) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  // Rule tests run the full (Advanced) rulebook unless a test says otherwise.
  const settings: Settings = { ...defaultSettings(n), mode: 'advanced', agencies: suggestedAgencies(n, 'advanced'), ...patch };
  const game = new Game(players, settings, { seed, now: clock.now });
  const meta = { connected: Object.fromEntries(players.map((p) => [p.id, true])), hostId: 'p0' };
  const view = (id: string): GameView => game.viewFor(id, meta);
  const next = () => {
    game.expirePhase();
    game.tick();
  };
  return { game, clock, view, next, players };
}

/** Run phases until `phase` is reached (or the game ends). */
function runTo(g: ReturnType<typeof setup>, phase: GameView['phase'], round?: number) {
  for (let i = 0; i < 200; i++) {
    if (g.game.phase === phase && (round === undefined || g.game.round === round)) return;
    if (g.game.phase === 'report' || g.game.phase === 'inquiry') return;
    g.next();
  }
  throw new Error('runTo never reached ' + phase);
}

describe('board', () => {
  it('has 31 regions, 59 symmetric borders and a diameter of 7', () => {
    expect(REGION_CODES.length).toBe(31);
    expect(BORDER_PAIRS.length).toBe(59);
    for (const a of REGION_CODES) for (const b of REGIONS[a].borders) expect(REGIONS[b].borders).toContain(a);
    const max = Math.max(...REGION_CODES.flatMap((a) => REGION_CODES.map((b) => DIST[a][b])));
    expect(max).toBe(7);
    expect(dist('LA', 'NL')).toBe(7);
  });

  it('keeps every region within 3 borders of a default gate', () => {
    const gates = gatesFor(6);
    expect(gates.sort()).toEqual(['BR', 'DL', 'KL', 'MH', 'MN', 'WB']);
    for (const c of REGION_CODES) expect(Math.min(...gates.map((g) => dist(c, g)))).toBeLessThanOrEqual(3);
    expect(gatesFor(5)).not.toContain('MN');
    expect(gatesFor(7)).toContain('TN');
  });

  it('points compass directions the right way', () => {
    expect(bearing('GJ', 'WB')).toBe('E');
    expect(bearing('KL', 'LA')).toBe('N');
    expect(bearing('DL', 'TN')).toBe('S');
    expect(bearing('MH', 'MH')).toBe('Here');
  });
});

describe('rules', () => {
  const nonMedia = (g: Game) => g.seats.filter((s) => s.agency !== 'MEDIA').map((s) => s.id);

  it('limits a jeep to 2 borders after Round 1', () => {
    const g = setup(5);
    for (const p of g.players) g.game.act(p.id, { type: 'deploy', region: 'MP' });
    runTo(g, 'deploy', 2);
    const opts = g.view('p0').deployOptions!;
    for (const c of opts) expect(dist('MP', c)).toBeLessThanOrEqual(2);
    expect(opts).toContain('MP');
    expect(g.game.act('p0', { type: 'deploy', region: 'KL' }).ok).toBe(false);
  });

  it('punishes a wrong warrant: -3, suspension and a tip-off move', () => {
    const g = setup(6, { news: false });
    const [a, b] = nonMedia(g.game);
    runTo(g, 'action', 1);
    const F = g.game.debugState().fugitive;
    const wrong = REGION_CODES.find((c) => c !== F)!;
    expect(g.game.act(a, { type: 'warrantPropose', region: wrong, invite: [b] }).ok).toBe(true);
    expect(g.game.act(b, { type: 'warrantRespond', warrantId: 'w1-1', accept: true }).ok).toBe(true);
    g.next();
    expect(g.game.phase).toBe('night');
    expect(g.view(a).me.suspended).toBe(true);
    expect(g.view(b).me.suspended).toBe(true);
    expect(g.game.debugState().tipOffPending).toBe(true);
    const ev = g.game.debugState().scoreEvents.filter((e) => e.points === -3);
    expect(ev.map((e) => e.pid).sort()).toEqual([a, b].sort());
    runTo(g, 'deploy', 2);
    expect(g.view(a).deployOptions).toBeNull();
  });

  it('arrests on a correct warrant and scores 7 / 6 / 1', () => {
    const g = setup(6, { news: false });
    const ids = nonMedia(g.game).filter((id) => !g.game.debugState().mantris.includes(id));
    const [a, b] = ids;
    runTo(g, 'action', 1);
    const F = g.game.debugState().fugitive;
    g.game.act(a, { type: 'warrantPropose', region: F, invite: [b] });
    g.game.act(b, { type: 'warrantRespond', warrantId: 'w1-1', accept: true });
    g.next();
    expect(g.game.phase).toBe('inquiry');
    expect(g.game.outcome?.type).toBe('arrest');
    const ev = g.game.debugState().scoreEvents;
    expect(ev.find((e) => e.pid === a)?.points).toBe(7);
    expect(ev.find((e) => e.pid === b)?.points).toBe(6);
    const mantri = g.game.debugState().mantris[0];
    expect(ev.some((e) => e.pid === mantri)).toBe(false);
    const others = g.game.seats.filter((s) => ![a, b, mantri].includes(s.id));
    for (const o of others) expect(ev.find((e) => e.pid === o.id)?.points).toBe(1);
  });

  it('lets him fly from an unsealed gate he held for a full round', () => {
    const g = setup(5, { news: false, earliestEscape: 3 });
    runTo(g, 'action', 2);
    // Put him on Kerala's gate for Round 2 with every jeep far away.
    const far = Object.fromEntries(g.players.map((p) => [p.id, 'LA' as RegionCode]));
    g.game.debugSet({ fugitive: 'KL', jeeps: far });
    const mantri = g.game.debugState().mantris[0];
    expect(g.view(mantri).mantri!.canFly).toBe(true);
    g.next(); // -> night 3
    expect(g.game.phase).toBe('night');
    expect(g.game.act(mantri, { type: 'nightOrders', orders: { steps: [], hawala: false, fly: true } }).ok).toBe(true);
    g.next();
    expect(g.game.outcome?.type).toBe('escape');
    expect(g.game.phase).toBe('inquiry');
  });

  it('blocks the escape when a jeep stood on the gate', () => {
    const g = setup(5, { news: false, earliestEscape: 3 });
    runTo(g, 'action', 2);
    const jeeps = Object.fromEntries(g.players.map((p) => [p.id, 'LA' as RegionCode]));
    jeeps.p1 = 'KL';
    g.game.debugSet({ fugitive: 'KL', jeeps });
    g.next();
    const mantri = g.game.debugState().mantris[0];
    expect(g.game.act(mantri, { type: 'nightOrders', orders: { steps: [], hawala: false, fly: true } }).ok).toBe(false);
  });

  it('delivers a Planted Leak instead of the real clue', () => {
    const g = setup(6, { news: false, agencies: ['CBI', 'NIA', 'ED', 'POLICE', 'MEDIA', 'IB'] });
    const mantri = g.game.debugState().mantris[0];
    const target = g.game.seats.find((s) => s.id !== mantri && s.agency === 'CBI') ?? g.game.seats.find((s) => s.id !== mantri && s.agency === 'NIA')!;
    for (const p of g.players) g.game.act(p.id, { type: 'deploy', region: 'LA' });
    g.game.debugSet({ fugitive: 'KL' });
    const fake = target.agency === 'CBI' ? { kind: 'CBI' as const, value: 2 } : { kind: 'NIA' as const, value: 'N' as const };
    expect(g.game.act(mantri, { type: 'leakArm', target: target.id, clue: fake }).ok).toBe(true);
    runTo(g, 'press', 1);
    expect(g.view(target.id).myClue?.clue).toEqual(fake);
    // Faithful report of a planted clue is labelled Planted in the report; a Sting shows MATCH.
    g.game.act(target.id, { type: 'press', claim: { clue: fake, hot: false } });
  });

  it('refuses a leak that fakes a Hot Trail', () => {
    const g = setup(5, { agencies: ['CBI', 'NIA', 'ED', 'POLICE', 'MEDIA'] });
    const mantri = g.game.debugState().mantris[0];
    const t = g.game.seats.find((s) => s.id !== mantri && (s.agency === 'CBI'));
    if (!t) return;
    expect(g.game.act(mantri, { type: 'leakArm', target: t.id, clue: { kind: 'CBI', value: 0 } }).ok).toBe(false);
  });

  it('checks Press Release formats', () => {
    const g = setup(5, { agencies: ['CBI', 'NIA', 'ED', 'POLICE', 'MEDIA'] });
    runTo(g, 'press', 1);
    const cbi = g.game.seats.find((s) => s.agency === 'CBI')!;
    expect(g.game.act(cbi.id, { type: 'press', claim: { clue: { kind: 'NIA', value: 'N' }, hot: false } }).ok).toBe(false);
    expect(g.game.act(cbi.id, { type: 'press', claim: { clue: { kind: 'CBI', value: 9 }, hot: false } }).ok).toBe(false);
    expect(g.game.act(cbi.id, { type: 'press', claim: { clue: { kind: 'CBI', value: 3 }, hot: false } }).ok).toBe(true);
    expect(g.game.act(cbi.id, { type: 'press', claim: { none: true } }).ok).toBe(true);
  });

  it('runs a Sting and scores Media', () => {
    const g = setup(5, { agencies: ['CBI', 'NIA', 'ED', 'POLICE', 'MEDIA'], news: false });
    runTo(g, 'press', 1);
    const media = g.game.seats.find((s) => s.agency === 'MEDIA')!;
    const liar = g.game.seats.find((s) => s.agency === 'POLICE')!;
    const truth = g.view(liar.id).myClue!;
    const lie = { kind: 'POLICE' as const, value: !(truth.clue as { value: boolean }).value };
    g.game.act(liar.id, { type: 'press', claim: { clue: lie, hot: false } });
    runTo(g, 'talk', 1);
    expect(g.game.act(media.id, { type: 'sting', target: liar.id }).ok).toBe(true);
    const item = g.view(media.id).feed.find((f) => f.kind === 'sting')!;
    expect(item.sting?.verdict).toBe('MISMATCH');
    expect(g.game.act(media.id, { type: 'sting', target: liar.id }).ok).toBe(false);
  });

  it('scores the Inquiry', () => {
    const g = setup(5, { news: false, rounds: 5 });
    runTo(g, 'action', 1);
    const F = g.game.debugState().fugitive;
    const [a, b] = nonMedia(g.game).filter((id) => !g.game.debugState().mantris.includes(id));
    g.game.act(a, { type: 'warrantPropose', region: F, invite: [b] });
    g.game.act(b, { type: 'warrantRespond', warrantId: 'w1-1', accept: true });
    g.next();
    expect(g.game.phase).toBe('inquiry');
    const m = g.game.debugState().mantris[0];
    for (const s of g.game.seats) {
      const target = s.id === m ? g.game.seats.find((x) => x.id !== m)!.id : m;
      expect(g.game.act(s.id, { type: 'inquiryVote', targets: [target] }).ok).toBe(true);
    }
    g.game.tick();
    expect(g.game.phase).toBe('report');
    const rep = g.view('p0').report!;
    const mLine = rep.scores.find((x) => x.id === m)!;
    expect(mLine.events.some((e) => e.reason === 'Exposed by the Inquiry' && e.points === -3)).toBe(true);
    const aLine = rep.scores.find((x) => x.id === a)!;
    expect(aLine.total).toBe(7 + 2);
  });

  it('handles the Suitcase both ways', () => {
    for (const accept of [true, false]) {
      const g = setup(6, { news: false });
      const m = g.game.debugState().mantris[0];
      const target = g.game.seats.find((s) => s.id !== m)!.id;
      runTo(g, 'night', 2);
      expect(g.game.act(m, { type: 'nightOrders', orders: { steps: [], hawala: false, fly: false, suitcaseTarget: target } }).ok).toBe(true);
      runTo(g, 'talk', 2);
      expect(g.view(target).suitcaseOffer?.status).toBe('pending');
      expect(g.game.act(target, { type: 'suitcaseRespond', accept }).ok).toBe(true);
      const v = g.view(target);
      if (accept) {
        expect(v.me.role).toBe('bought');
        expect(v.bought?.fugitive).toBe(g.game.debugState().fugitive);
      } else {
        expect(v.me.role).toBe('agency');
        expect(v.private.some((p) => p.kind === 'suitcase' && p.text.includes('The offer came from'))).toBe(true);
      }
    }
  });
});

describe('no timer and skipping', () => {
  it('waits for everyone when timers are off, and Night waits for Mantri ji', () => {
    const g = setup(5, { timers: 'off', news: false });
    expect(g.game.phaseEndsAt).toBe(0);
    g.clock.advance(10 * 60 * 1000);
    expect(g.game.tick()).toBe(false);
    expect(g.game.phase).toBe('deploy');
    for (const p of g.players) g.game.act(p.id, { type: 'ready', ready: true });
    g.game.tick();
    expect(g.game.phase).toBe('press'); // clues arrive straight after Move: no Briefing step
    for (const p of g.players) if (g.view(p.id).myClue) g.game.act(p.id, { type: 'press', claim: { none: true } });
    g.game.tick();
    expect(g.game.phase).toBe('talk');
    for (const p of g.players) g.game.act(p.id, { type: 'ready', ready: true });
    g.game.tick();
    expect(g.game.phase).toBe('action');
    for (const p of g.players) g.game.act(p.id, { type: 'ready', ready: true });
    g.game.tick();
    expect(g.game.phase).toBe('night');
    g.clock.advance(10 * 60 * 1000);
    g.game.tick();
    expect(g.game.phase).toBe('night');
    const m = g.game.debugState().mantris[0];
    const other = g.players.find((p) => p.id !== m)!.id;
    expect(g.game.act(other, { type: 'ready', ready: true }).ok).toBe(false);
    expect(g.game.act(m, { type: 'ready', ready: true }).ok).toBe(true);
    g.game.tick();
    expect(g.game.phase).toBe('deploy');
  });

  it('lets the host skip a step', () => {
    const g = setup(5, { timers: 'off' });
    expect(g.game.forceAdvance()).toBe(true);
    expect(g.game.phase).toBe('press');
    g.game.pause();
    expect(g.game.forceAdvance()).toBe(false);
    g.game.resume();
    expect(g.game.phaseEndsAt).toBe(0);
  });

  it('plays Simple mode with only the core rules', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const game = new Game(players, defaultSettings(6), { seed: 3 });
    expect(game.settings.mode).toBe('simple');
    expect(game.settings.leaks + game.settings.hawala).toBe(0);
    expect(game.settings.suitcase || game.settings.news || game.settings.hiddenAgencies).toBe(false);
    expect([...game.settings.agencies].sort()).toEqual(['CBI', 'CUSTOMS', 'ED', 'NIA', 'POLICE', 'CRIME'].sort());
  });
});

describe('random full games', () => {
  it('finishes hundreds of chaotic games without breaking or leaking secrets', () => {
    const outcomes: Record<string, number> = { arrest: 0, escape: 0, survived: 0 };
    for (let seed = 1; seed <= 300; seed++) {
      const rng = new Rng(seed * 7919);
      const n = 5 + rng.int(4);
      const agencies = rng.shuffle(AGENCY_IDS).slice(0, n) as AgencyId[];
      const patch: Partial<Settings> = {
        mode: rng.pick(['simple', 'advanced'] as const),
        timers: rng.pick(['off', 'short', 'standard'] as const),
        agencies,
        rounds: rng.pick([5, 6, 7] as const),
        distance: rng.pick(['exact', 'banded'] as const),
        mantris: n >= 7 && rng.next() < 0.4 ? 2 : 1,
        leaks: rng.pick([0, 1, 2] as const),
        hawala: rng.pick([0, 1, 2, 3] as const),
        suitcase: rng.next() < 0.8,
        gates: rng.pick([5, 6, 7] as const),
        circulars: rng.pick([2, 3, 4] as const),
        earliestEscape: rng.pick([3, 4, 5] as const),
        stings: rng.pick([1, 2, 3] as const),
        news: rng.next() < 0.8,
        hiddenAgencies: rng.next() < 0.25,
      };
      const g = setup(n, patch, seed);
      let guard = 0;
      while (g.game.phase !== 'report') {
        if (guard++ > 3000) throw new Error(`seed ${seed} stuck in ${g.game.phase}`);
        for (const s of g.game.seats) {
          const v = g.view(s.id);
          // Secrets: only Mantri ji and Bought agencies may see where he is before the report.
          if (v.me.role === 'agency') {
            expect(v.mantri).toBeNull();
            expect(v.bought).toBeNull();
            expect(JSON.stringify(v)).not.toContain('"fugitive"');
          }
          if (g.game.settings.hiddenAgencies) {
            expect(v.settings.agencies).toEqual([]);
            if (v.me.role !== 'mantri') for (const p of v.players) if (p.id !== s.id) expect(p.agency).toBeUndefined();
          }
          for (const a of botActions(v, rng)) g.game.act(s.id, a);
        }
        g.clock.advance(500 + rng.int(6000));
        g.game.tick();
      }
      const rep = g.view('p0').report!;
      expect(rep).toBeTruthy();
      outcomes[rep.outcome.type]++;
      if (patch.mode === 'simple') {
        // Simple mode switches every advanced system off.
        expect(g.game.settings.leaks).toBe(0);
        expect(g.game.settings.suitcase).toBe(false);
        expect(g.game.settings.news).toBe(false);
        expect(rep.rounds.every((r) => r.steps.every((st) => st.how !== 'hawala'))).toBe(true);
      }
      const evTotal = g.game.debugState().scoreEvents.reduce((a, e) => a + e.points, 0);
      expect(rep.scores.reduce((a, s) => a + s.total, 0)).toBe(evTotal);
      expect(rep.roles.filter((r) => r.role === 'mantri').length).toBe(patch.mode === 'simple' ? 1 : patch.mantris);
    }
    expect(outcomes.arrest).toBeGreaterThan(0);
    expect(outcomes.escape).toBeGreaterThan(0);
    expect(outcomes.survived).toBeGreaterThan(0);
    console.log('outcomes over 300 chaotic games', outcomes);
  });
});
