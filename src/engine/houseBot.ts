import { bearing, dist } from '../shared/graph';
import { REGIONS, REGION_CODES, type RegionCode } from '../shared/regions';
import type { Rng } from '../shared/rng';
import type { Clue, EdQuestion, GameAction, GameView, NightOrders, PlayerId, PressClaim } from '../shared/types';
import { cbiValue, closestJeeps, computeClue, evalEd } from './clues';

/**
 * "House" bots that fill empty seats. They play fair: they only use what their own view shows
 * (their clues, the public feed, Press Releases), never hidden server state.
 */

export interface BotMemory {
  /** One-off decisions already made this phase. */
  done: Set<string>;
  phaseKey: string;
  /** Regions the bot still thinks he could be in (null = anywhere). */
  cands: Set<RegionCode> | null;
  /** Rounds whose movement / clues were already folded into `cands`. */
  movedFor: number;
  ownClueFor: number;
  pressFor: number;
  /** How often each player's Press Release contradicted what this bot knew. */
  suspicion: Record<PlayerId, number>;
  replied: Set<string>;
}

export function newBotMemory(): BotMemory {
  return { done: new Set(), phaseKey: '', cands: null, movedFor: 1, ownClueFor: 0, pressFor: 0, suspicion: {}, replied: new Set() };
}

const REPLIES = [
  "🤖 Beep. I'm a bot, so I can't chat. Watch my Press Releases.",
  "🤖 Bot here. I'll sign a warrant if it fits what I know.",
  '🤖 Just a bot. Invite me to a warrant and I might sign.',
];

const allRegions = () => new Set<RegionCode>(REGION_CODES);

/** Chance a bot takes another player's Press Release into account. */
const LISTEN = 0.5;

/** Would a clue seen from `from` be true if he were in `c`? `null` = the clue can't be used for this. */
export function clueFits(
  clue: Clue,
  c: RegionCode,
  from: RegionCode,
  ctx: { allGates: RegionCode[]; openGates: RegionCode[]; jeeps: Record<PlayerId, RegionCode | null>; distance: 'exact' | 'banded' },
): boolean | null {
  switch (clue.kind) {
    case 'CBI':
      return cbiValue(dist(from, c), ctx.distance) === clue.value;
    case 'NIA':
      return bearing(from, c) === clue.value;
    case 'CYBER':
      return clue.value === 'No signal' ? dist(from, c) > 3 : clue.value.includes(c);
    case 'POLICE':
      return (dist(from, c) <= 1) === clue.value;
    case 'CRIME':
      return clue.value === 'Now' ? c === from : c !== from;
    case 'ED':
      return evalEd(clue.question, c, from, ctx.allGates) === clue.value;
    case 'IT': {
      const m = (x: RegionCode) => (clue.metric === 'seats' ? REGIONS[x].seats : REGIONS[x].borders.length);
      const v = m(c) > m(from) ? 'More' : m(c) < m(from) ? 'Fewer' : 'Same';
      return v === clue.value;
    }
    case 'CUSTOMS': {
      const ds = ctx.openGates.map((g) => dist(c, g));
      return (ds.length ? Math.min(...ds) : 7) === clue.value;
    }
    case 'IB':
      return JSON.stringify(closestJeeps(c, ctx.jeeps)) === JSON.stringify([...clue.value].sort());
    default:
      return null; // RPF and RAW describe the past, not where he is now
  }
}

function filterBy(cands: Set<RegionCode>, clue: Clue, from: RegionCode, ctx: Parameters<typeof clueFits>[3]): Set<RegionCode> | null {
  const out = new Set<RegionCode>();
  for (const c of cands) {
    const fit = clueFits(clue, c, from, ctx);
    if (fit === null) return null;
    if (fit) out.add(c);
  }
  return out;
}

/** Spread the candidate set to cover tonight's possible moves. */
function expand(cands: Set<RegionCode>, steps: number, moved: boolean): Set<RegionCode> {
  const out = new Set<RegionCode>();
  for (const c of cands) {
    if (!moved) out.add(c);
    for (const r of REGION_CODES) {
      const d = dist(c, r);
      if (d >= 1 && d <= steps) out.add(r);
    }
  }
  return out;
}

function pickEdQuestion(rng: Rng, cands: Set<RegionCode> | null): EdQuestion {
  const qs: EdQuestion[] = [
    { q: 'coastal' }, { q: 'hindi' }, { q: 'gate' },
    { q: 'zone', zone: 'North' }, { q: 'zone', zone: 'Central' }, { q: 'zone', zone: 'East' },
    { q: 'zone', zone: 'South' }, { q: 'zone', zone: 'Northeast' }, { q: 'zone', zone: 'West' },
    { q: 'seats', n: 20 }, { q: 'seats', n: 10 }, { q: 'neighbours', n: 4 },
    { q: 'borders', country: 'Nepal' }, { q: 'borders', country: 'Bangladesh' }, { q: 'borders', country: 'Pakistan' },
  ];
  if (!cands || cands.size < 2) return rng.pick(qs);
  // The best question splits the remaining regions closest to half and half.
  let best = qs[0];
  let bestScore = Infinity;
  for (const q of rng.shuffle(qs)) {
    const yes = [...cands].filter((c) => evalEd(q, c, c, [])).length;
    const score = Math.abs(yes - cands.size / 2);
    if (score < bestScore) {
      best = q;
      bestScore = score;
    }
  }
  return best;
}

/** A believable lie: the clue they'd have seen if he were hiding in `decoy`. */
function clueAsIf(v: GameView, truth: Clue, from: RegionCode, decoy: RegionCode, rng: Rng): Clue | null {
  const allGates = v.gates.map((g) => g.code);
  const openGates = v.gates.filter((g) => !g.sealed).map((g) => g.code);
  const jeeps = Object.fromEntries(v.players.map((p) => [p.id, p.jeep]));
  const agency = ({ CBI: 'CBI', NIA: 'NIA', CYBER: 'CYBER', POLICE: 'POLICE', CRIME: 'CRIME', ED: 'ED', IT: 'IT', CUSTOMS: 'CUSTOMS', RPF: 'RPF', RAW: 'RAW', IB: 'IB' } as const)[truth.kind];
  const fake = computeClue(agency, from, {
    F: decoy, nightStart: decoy, round: v.round, visited: new Set([decoy]), openGates, allGates, jeeps,
    distance: v.settings.distance, rng,
    edQuestion: truth.kind === 'ED' ? truth.question : undefined,
    itMetric: truth.kind === 'IT' ? truth.metric : undefined,
  });
  return fake;
}

function decoyRegion(fugitive: RegionCode, rng: Rng, avoid: RegionCode | null): RegionCode {
  const far = REGION_CODES.filter((c) => dist(c, fugitive) >= 3 && c !== avoid);
  return far.length ? rng.pick(far) : rng.pick(REGION_CODES.filter((c) => c !== fugitive));
}

function planNight(v: GameView, rng: Rng): NightOrders {
  const m = v.mantri!;
  if (m.canFly) return { steps: [], hawala: false, fly: true };
  const F = m.fugitive;
  const openGates = v.gates.filter((g) => !g.sealed).map((g) => g.code);
  const jeepAt = new Set(v.players.map((p) => p.jeep).filter(Boolean) as RegionCode[]);
  const targets = openGates.filter((g) => !jeepAt.has(g));
  const goal = (targets.length ? targets : openGates).sort((a, b) => dist(F, a) - dist(F, b) || rng.next() - 0.5)[0];
  const steps: RegionCode[] = [];
  let at = F;
  for (let i = 0; i < m.maxSteps; i++) {
    if (!m.mustMove && at === goal) break;
    const opts = REGIONS[at].borders.filter((b) => m.reachable.includes(b) || b === F);
    if (!opts.length) break;
    const scored = opts
      .map((b) => ({ b, s: (goal ? dist(b, goal) : 0) + (jeepAt.has(b) ? 1.5 : 0) + rng.next() * 0.8 }))
      .sort((x, y) => x.s - y.s);
    const next = scored[0].b;
    if (!m.mustMove && goal && dist(next, goal) >= dist(at, goal) && i > 0) break;
    steps.push(next);
    at = next;
    if (!m.mustMove && rng.next() < 0.25) break; // sometimes lie low
  }
  if (m.mustMove && steps.length === 0) {
    const opts = REGIONS[F].borders.filter((b) => m.reachable.includes(b));
    if (opts.length) steps.push(rng.pick(opts));
  }
  const normalSteps = steps.length - (m.tipOffPending && steps.length ? 1 : 0);
  const hawala = normalSteps > 0 && m.hawalaLeft > 0 && rng.next() < 0.45;
  let suitcaseTarget: string | undefined;
  if (m.suitcaseAvailable && rng.next() < 0.35) {
    const pool = v.players.filter((p) => p.id !== v.me.id && !m.partners.includes(p.id) && !m.bought.includes(p.id));
    const humans = pool.filter((p) => !p.bot);
    const pick = humans.length && rng.next() < 0.6 ? rng.pick(humans) : pool.length ? rng.pick(pool) : null;
    suitcaseTarget = pick?.id;
  }
  return { steps, hawala, fly: false, suitcaseTarget };
}

export function houseBotActions(v: GameView, rng: Rng, mem: BotMemory): GameAction[] {
  const out: GameAction[] = [];
  const me = v.me.id;
  const key = `${v.round}:${v.phase}`;
  if (mem.phaseKey !== key) {
    mem.phaseKey = key;
    mem.done.clear();
  }
  const once = (k: string) => {
    if (mem.done.has(k)) return false;
    mem.done.add(k);
    return true;
  };
  const others = v.players.filter((p) => p.id !== me);
  const humans = others.filter((p) => !p.bot);
  const m = v.mantri;
  const secret = m?.fugitive ?? v.bought?.fugitive ?? null;
  const traitor = v.me.role !== 'agency';
  const ctx = {
    allGates: v.gates.map((g) => g.code),
    openGates: v.gates.filter((g) => !g.sealed).map((g) => g.code),
    jeeps: Object.fromEntries(v.players.map((p) => [p.id, p.jeep])) as Record<PlayerId, RegionCode | null>,
    distance: v.settings.distance,
  };

  // ── keep the belief state up to date (honest bots only use public info and their own clues) ──
  if (!mem.cands) mem.cands = new Set(REGION_CODES.filter((c) => !ctx.allGates.includes(c)));
  if (v.round > mem.movedFor && v.phase !== 'night') {
    for (let r = mem.movedFor + 1; r <= v.round; r++) {
      const pinged = v.feed.some((f) => f.round === r && f.kind === 'ping');
      const tipoff = v.feed.some((f) => f.round === r - 1 && f.kind === 'warrant');
      mem.cands = expand(mem.cands, tipoff ? 2 : 1, pinged);
    }
    mem.movedFor = v.round;
  }
  if (v.myClue && mem.ownClueFor < v.round) {
    mem.ownClueFor = v.round;
    if (v.myClue.hot) mem.cands = new Set([v.myClue.from]);
    else {
      const f = filterBy(mem.cands, v.myClue.clue, v.myClue.from, ctx);
      if (f && f.size) mem.cands = f;
      else if (f) mem.cands = filterBy(allRegions(), v.myClue.clue, v.myClue.from, ctx) ?? mem.cands; // a leak or a bad guess: start over
    }
  }
  if (v.press.length && mem.pressFor < v.round) {
    mem.pressFor = v.round;
    for (const row of rng.shuffle(v.press)) {
      if (row.player === me || row.claim.none || !row.from) continue;
      // House bots are deliberately imperfect listeners, so they don't solve the hunt for the table.
      if (rng.next() > LISTEN) continue;
      if (row.claim.hot) {
        if (!mem.cands.has(row.from)) mem.suspicion[row.player] = (mem.suspicion[row.player] ?? 0) + 1;
        continue;
      }
      const f = filterBy(mem.cands, row.claim.clue, row.from, ctx);
      if (!f) continue;
      if (f.size === 0) mem.suspicion[row.player] = (mem.suspicion[row.player] ?? 0) + 1;
      else mem.cands = f;
    }
  }
  for (const f of v.feed) if (f.kind === 'sting' && f.sting?.verdict === 'MISMATCH' && f.round === v.round && once(`st-${f.id}`)) {
    mem.suspicion[f.sting.target] = (mem.suspicion[f.sting.target] ?? 0) + 2;
  }

  // ── answer DMs from people (once per sender per round) ──
  for (const d of v.dms) {
    const k = `${d.from}-${d.round}`;
    if (d.to === me && !mem.replied.has(k) && humans.some((h) => h.id === d.from)) {
      mem.replied.add(k);
      out.push({ type: 'dm', to: d.from, text: rng.pick(REPLIES) });
    }
  }

  const cands = mem.cands;
  switch (v.phase) {
    case 'night': {
      if (m && !(m.ordersLocked && m.ordersBy !== me) && once('orders')) out.push({ type: 'nightOrders', orders: planNight(v, rng) });
      if (m && !v.me.ready) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'deploy': {
      const opts = v.deployOptions;
      if (opts && once('deploy')) {
        let pool: RegionCode[];
        if (secret) pool = opts.filter((c) => dist(c, secret) >= 2); // protect him: don't flush him out
        else if (v.round === 1) pool = opts.filter((c) => !ctx.allGates.includes(c));
        else {
          const inside = opts.filter((c) => cands.has(c));
          pool = inside.length ? inside : [...opts].sort((a, b) => avgDist(a, cands) - avgDist(b, cands)).slice(0, 3);
        }
        out.push({ type: 'deploy', region: rng.pick(pool.length ? pool : opts) });
      }
      if (v.me.agency === 'ED' && opts && once('ed')) out.push({ type: 'edQuestion', question: pickEdQuestion(rng, cands) });
      if (v.me.agency === 'IT' && opts && once('it')) out.push({ type: 'itMetric', metric: rng.next() < 0.6 ? 'seats' : 'neighbours' });
      if (m && m.leaksLeft > 0 && !m.leakUsedThisRound && !m.leakArmed && once('leak') && rng.next() < 0.3) {
        const victims = others.filter((p) => !m.partners.includes(p.id) && p.agency && p.agency !== 'MEDIA' && !p.suspended && p.agency !== 'RPF' && p.agency !== 'RAW');
        if (victims.length) {
          const t = rng.pick(victims);
          const decoy = decoyRegion(m.fugitive, rng, t.jeep);
          const from = t.jeep ?? decoy;
          const probe = clueAsIf(v, seedClue(t.agency!, m.edQuestions[t.id], m.itMetrics[t.id]), from, decoy, rng);
          if (probe && !(probe.kind === 'CBI' && (probe.value === 0 || probe.value === 'Here')) && !(probe.kind === 'NIA' && probe.value === 'Here') && !(probe.kind === 'CRIME' && probe.value === 'Now')) {
            out.push({ type: 'leakArm', target: t.id, clue: probe });
          }
        }
      }
      if (!v.me.ready) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'press': {
      if (v.myClue && !v.myPress && once('press')) {
        let claim: PressClaim = { clue: v.myClue.clue, hot: v.myClue.hot };
        const r = rng.next();
        if (traitor && secret && r < 0.55) {
          const lie = clueAsIf(v, v.myClue.clue, v.myClue.from, decoyRegion(secret, rng, v.myClue.from), rng);
          if (lie) claim = { clue: lie, hot: false };
        } else if (!traitor && r < 0.06) claim = { none: true };
        out.push({ type: 'press', claim });
      }
      break;
    }
    case 'talk': {
      if (v.me.agency === 'MEDIA' && v.stingsLeft > 0 && !v.stingUsedThisRound && v.press.length && once('sting') && rng.next() < 0.5) {
        const suspects = [...v.press].sort((a, b) => (mem.suspicion[b.player] ?? 0) - (mem.suspicion[a.player] ?? 0));
        out.push({ type: 'sting', target: (rng.next() < 0.6 ? suspects[0] : rng.pick(v.press)).player });
      }
      if (v.suitcaseOffer?.status === 'pending' && once('suitcase')) out.push({ type: 'suitcaseRespond', accept: rng.next() < 0.3 });
      if (!v.me.ready) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'action': {
      for (const w of v.warrants) {
        if (w.status !== 'open' || !w.invited.includes(me) || !once(`w-${w.id}`)) continue;
        let accept: boolean;
        if (secret) accept = w.region !== secret && rng.next() < 0.8;
        else accept = cands.has(w.region) ? rng.next() < 0.8 : rng.next() < 0.15;
        if (v.signedThisRound || v.me.agency === 'MEDIA') accept = false;
        out.push({ type: 'warrantRespond', warrantId: w.id, accept });
      }
      const canPropose = v.me.agency !== 'MEDIA' && !v.me.suspended && !v.signedThisRound && v.news?.id !== 'COURT';
      if (canPropose && once('propose')) {
        const eligible = others.filter((p) => !p.suspended && (!p.agency || p.agency !== 'MEDIA'));
        const invite = pickInvitees(eligible, rng);
        let region: RegionCode | null = null;
        if (!traitor) {
          // Bots leave Round 1 to the people at the table.
          if (v.round === 1) region = null;
          else if (v.myClue?.hot) region = v.myClue.from;
          else if (cands.size === 1 && rng.next() < 0.6) region = [...cands][0];
          else if (cands.size === 2 && rng.next() < 0.2) region = rng.pick([...cands]);
        } else if (secret && v.round > 1 && rng.next() < 0.12) {
          region = rng.pick([...cands].filter((c) => c !== secret).concat(decoyRegion(secret, rng, null)));
        }
        if (region && invite.length) out.push({ type: 'warrantPropose', region, invite });
      }
      if (!v.circular && v.circularsLeft > 0 && !v.me.suspended && once('circ') && rng.next() < 0.18) {
        const open = v.gates.filter((g) => !g.sealed).map((g) => g.code);
        let gate: RegionCode | undefined;
        if (secret) gate = [...open].sort((a, b) => dist(secret, b) - dist(secret, a))[0]; // seal the gate he doesn't need
        else gate = [...open].sort((a, b) => avgDist(a, cands) - avgDist(b, cands))[0];
        if (gate) out.push({ type: 'circularPropose', gate });
      }
      if (v.circular && !v.me.suspended && v.circular.votes[me] === undefined && once('vote')) {
        let yes: boolean;
        if (secret) {
          const nearest = [...ctx.openGates].sort((a, b) => dist(secret, a) - dist(secret, b))[0];
          yes = v.circular.gate !== nearest && rng.next() < 0.8;
        } else yes = avgDist(v.circular.gate, cands) <= 2.5 ? rng.next() < 0.85 : rng.next() < 0.45;
        out.push({ type: 'circularVote', yes });
      }
      if (v.suitcaseOffer?.status === 'pending' && once('suitcase2')) out.push({ type: 'suitcaseRespond', accept: rng.next() < 0.3 });
      if (!v.me.ready) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'inquiry': {
      if (v.inquiry && v.inquiry.myVote.length === 0 && once('inq')) {
        const pool = others.filter((p) => !(m?.partners.includes(p.id)));
        const ranked = rng.shuffle(pool).sort((a, b) => (mem.suspicion[b.id] ?? 0) - (mem.suspicion[a.id] ?? 0));
        out.push({ type: 'inquiryVote', targets: ranked.slice(0, v.inquiry.picks).map((p) => p.id) });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function avgDist(c: RegionCode, set: Set<RegionCode>): number {
  if (!set.size) return 0;
  let s = 0;
  for (const x of set) s += dist(c, x);
  return s / set.size;
}

/** Invite people first (so a solo tester gets involved), then bots. */
function pickInvitees(eligible: GameView['players'], rng: Rng): PlayerId[] {
  const humans = rng.shuffle(eligible.filter((p) => !p.bot));
  const bots = rng.shuffle(eligible.filter((p) => p.bot));
  return [...humans, ...bots].slice(0, 1 + (rng.next() < 0.6 ? 1 : 0)).map((p) => p.id);
}

/** A placeholder clue in the target's format, used only to tell `clueAsIf` which kind to compute. */
function seedClue(agency: NonNullable<GameView['players'][number]['agency']>, ed?: EdQuestion, metric?: 'seats' | 'neighbours'): Clue {
  switch (agency) {
    case 'ED': return { kind: 'ED', question: ed ?? { q: 'coastal' }, value: false };
    case 'IT': return { kind: 'IT', metric: metric ?? 'seats', value: 'Same' };
    case 'CBI': return { kind: 'CBI', value: 1 };
    case 'NIA': return { kind: 'NIA', value: 'N' };
    case 'CYBER': return { kind: 'CYBER', value: 'No signal' };
    case 'POLICE': return { kind: 'POLICE', value: false };
    case 'CRIME': return { kind: 'CRIME', value: 'Never' };
    case 'CUSTOMS': return { kind: 'CUSTOMS', value: 1 };
    case 'IB': return { kind: 'IB', value: [] };
    case 'RPF': return { kind: 'RPF', value: 'Did not move' };
    case 'RAW': return { kind: 'RAW', value: 'North' };
    default: return { kind: 'CBI', value: 1 };
  }
}
