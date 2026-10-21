import { DIRS } from '../shared/graph';
import { COUNTRIES, REGIONS, REGION_CODES, ZONES, type RegionCode } from '../shared/regions';
import type { Rng } from '../shared/rng';
import type { Clue, ClueKind, EdQuestion, GameAction, GameView, PlayerId } from '../shared/types';
import { AGENCY_CLUE } from './clues';

/** A random-but-legal value for a clue kind. Used by bots to lie and to plant leaks. */
export function randomClue(kind: ClueKind, view: GameView, rng: Rng, opts: { ed?: EdQuestion; metric?: 'seats' | 'neighbours'; noHot?: boolean } = {}): Clue {
  const ids = view.players.map((p) => p.id);
  switch (kind) {
    case 'CBI':
      return view.settings.distance === 'exact'
        ? { kind, value: 1 + rng.int(7) }
        : { kind, value: rng.pick(['1–2', '3–4', '5+'] as const) };
    case 'NIA':
      return { kind, value: rng.pick(DIRS) };
    case 'CYBER':
      return { kind, value: 'No signal' };
    case 'POLICE':
      return { kind, value: rng.next() < 0.5 };
    case 'CRIME':
      return { kind, value: rng.pick(['Earlier', 'Never'] as const) };
    case 'ED':
      return { kind, question: opts.ed ?? { q: 'coastal' }, value: rng.next() < 0.5 };
    case 'IT':
      return { kind, metric: opts.metric ?? 'seats', value: rng.pick(['More', 'Fewer', 'Same'] as const) };
    case 'CUSTOMS':
      return { kind, value: rng.int(4) };
    case 'RPF':
      return { kind, value: rng.pick([...DIRS, 'Did not move'] as const) };
    case 'RAW':
      return { kind, value: rng.pick(ZONES) };
    case 'IB':
      return { kind, value: [rng.pick(ids)] };
  }
}

function randomEdQuestion(rng: Rng): EdQuestion {
  const r = rng.int(8);
  switch (r) {
    case 0: return { q: 'coastal' };
    case 1: return { q: 'borders', country: rng.pick(COUNTRIES) };
    case 2: return { q: 'zone', zone: rng.pick(ZONES) };
    case 3: return { q: 'hindi' };
    case 4: return { q: 'seats', n: rng.pick([5, 10, 20, 30, 40]) };
    case 5: return { q: 'neighbours', n: rng.pick([2, 3, 4, 5, 6]) };
    case 6: return { q: 'gate' };
    default: return { q: 'sameZone' };
  }
}

/**
 * A chaotic bot: always legal-ish, often random. Good for exercising every rule, not for playing well.
 * Returns the actions it wants to send for the current view. Bots may send an action twice; the engine
 * must cope.
 */
export function botActions(view: GameView, rng: Rng): GameAction[] {
  const me = view.players.find((p) => p.id === view.me.id)!;
  const out: GameAction[] = [];
  const others = view.players.filter((p) => p.id !== me.id);
  const mantri = view.mantri;

  switch (view.phase) {
    case 'night': {
      if (mantri && !(mantri.ordersLocked && mantri.ordersBy !== me.id) && rng.next() < 0.6) {
        if (mantri.canFly && rng.next() < 0.7) {
          out.push({ type: 'nightOrders', orders: { steps: [], hawala: false, fly: true } });
          break;
        }
        const steps: RegionCode[] = [];
        let at = mantri.fugitive;
        const n = mantri.mustMove ? Math.max(1, rng.int(mantri.maxSteps + 1)) : rng.int(mantri.maxSteps + 1);
        for (let i = 0; i < n; i++) {
          const opts = REGIONS[at].borders.filter((b) => mantri.reachable.includes(b) || b === mantri.fugitive);
          if (!opts.length) break;
          at = rng.pick(opts);
          steps.push(at);
        }
        const target = mantri.suitcaseAvailable && rng.next() < 0.4
          ? rng.pick(others.filter((p) => !mantri.partners.includes(p.id))).id
          : undefined;
        out.push({ type: 'nightOrders', orders: { steps, hawala: rng.next() < 0.4, fly: false, suitcaseTarget: target } });
      }
      break;
    }
    case 'deploy': {
      if (view.deployOptions && rng.next() < 0.9) out.push({ type: 'deploy', region: rng.pick(view.deployOptions) });
      if (view.me.agency === 'ED') out.push({ type: 'edQuestion', question: randomEdQuestion(rng) });
      if (view.me.agency === 'IT') out.push({ type: 'itMetric', metric: rng.next() < 0.5 ? 'seats' : 'neighbours' });
      if (mantri && mantri.leaksLeft > 0 && !mantri.leakUsedThisRound && rng.next() < 0.3) {
        const targets = view.players.filter((p) => p.id !== me.id && !mantri.partners.includes(p.id) && p.agency !== 'MEDIA' && !p.suspended);
        if (targets.length) {
          const t = rng.pick(targets);
          // In hidden-agency games bots can't see the agency; skip leaks then.
          const kind = t.agency ? AGENCY_CLUE[t.agency] : null;
          if (kind) {
            out.push({ type: 'leakArm', target: t.id, clue: randomClue(kind, view, rng, { ed: mantri.edQuestions[t.id], metric: mantri.itMetrics[t.id] }) });
          }
        }
      }
      if (rng.next() < 0.8) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'press': {
      if (view.myClue && !view.myPress) {
        const r = rng.next();
        if (r < 0.65) out.push({ type: 'press', claim: { clue: view.myClue.clue, hot: view.myClue.hot } });
        else if (r < 0.9) out.push({ type: 'press', claim: { clue: randomClue(view.myClue.clue.kind, view, rng), hot: rng.next() < 0.1 } });
        else out.push({ type: 'press', claim: { none: true } });
      }
      break;
    }
    case 'talk': {
      if (view.me.agency === 'MEDIA' && view.stingsLeft > 0 && !view.stingUsedThisRound && view.press.length && rng.next() < 0.5) {
        out.push({ type: 'sting', target: rng.pick(view.press).player });
      }
      if (view.suitcaseOffer?.status === 'pending' && rng.next() < 0.5) out.push({ type: 'suitcaseRespond', accept: rng.next() < 0.5 });
      if (rng.next() < 0.3) out.push({ type: 'dm', to: rng.pick(others).id, text: 'Trust me, check the east.' });
      if (rng.next() < 0.7) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'action': {
      const canSign = view.me.agency !== 'MEDIA' && !view.me.suspended && !view.signedThisRound;
      if (canSign && rng.next() < 0.25) {
        const eligible = view.players.filter((p) => p.id !== me.id && p.agency !== 'MEDIA' && !p.suspended);
        if (eligible.length) {
          const invite = rng.shuffle(eligible).slice(0, 1 + rng.int(2)).map((p) => p.id);
          const region = mantri ? rng.pick(REGION_CODES.filter((c) => c !== mantri.fugitive)) : rng.pick(REGION_CODES);
          out.push({ type: 'warrantPropose', region, invite });
        }
      }
      for (const w of view.warrants) {
        if (w.status === 'open' && w.invited.includes(me.id) && rng.next() < 0.7) {
          out.push({ type: 'warrantRespond', warrantId: w.id, accept: rng.next() < 0.6 });
        }
      }
      if (!view.circular && view.circularsLeft > 0 && !view.me.suspended && rng.next() < 0.2) {
        const open = view.gates.filter((g) => !g.sealed);
        if (open.length) out.push({ type: 'circularPropose', gate: rng.pick(open).code });
      }
      if (view.circular && !view.me.suspended && view.circular.votes[me.id] === undefined) {
        out.push({ type: 'circularVote', yes: rng.next() < 0.6 });
      }
      if (view.suitcaseOffer?.status === 'pending' && rng.next() < 0.5) out.push({ type: 'suitcaseRespond', accept: rng.next() < 0.5 });
      if (mantri && view.round < view.rounds && rng.next() < 0.3 && !(mantri.ordersLocked && mantri.ordersBy !== me.id)) {
        const nb = REGIONS[mantri.fugitive].borders;
        out.push({ type: 'nightOrders', orders: { steps: [rng.pick(nb)], hawala: false, fly: mantri.canFly && rng.next() < 0.5 } });
      }
      if (rng.next() < 0.6) out.push({ type: 'ready', ready: true });
      break;
    }
    case 'inquiry': {
      if (view.inquiry && view.inquiry.myVote.length === 0) {
        const targets = rng.shuffle(others).slice(0, view.inquiry.picks).map((p) => p.id as PlayerId);
        out.push({ type: 'inquiryVote', targets });
      }
      break;
    }
    default:
      break;
  }
  return out;
}
