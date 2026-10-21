import { AGENCIES, type AgencyId } from '../shared/agencies';
import { describeClue } from '../shared/describe';
import { areNeighbours, reachable } from '../shared/graph';
import { NEWS, NEWS_IDS, type NewsId } from '../shared/news';
import { REGIONS, REGION_CODES, gatesFor, isRegionCode, type RegionCode } from '../shared/regions';
import { Rng } from '../shared/rng';
import { TIMERS, type Settings } from '../shared/settings';
import type {
  CircularView, Clue, Dm, EdQuestion, FeedItem, FeedKind, GameAction, GameView, MantriView, Metric, NightOrders,
  Outcome, Phase, PlayerId, PressClaim, PressRow, PrivateItem, Report, ReportRound, Role, ScoreLine, StingResult,
  WarrantView,
} from '../shared/types';
import { AGENCY_CLUE, cleanClue, closestJeeps, computeClue, leakProblem, sameClue, validEdQuestion } from './clues';

export const COLOURS = ['#ff9933', '#4dabf7', '#51cf66', '#f783ac', '#ffd43b', '#b197fc', '#ff6b6b', '#3bc9db'];

interface Seat {
  id: PlayerId;
  name: string;
  agency: AgencyId;
  colour: string;
  mantri: boolean;
}

interface ClueRec {
  truth: Clue;
  received: Clue;
  planted: boolean;
  hot: boolean;
  from: RegionCode;
}

interface Warrant {
  id: string;
  round: number;
  proposer: PlayerId;
  region: RegionCode;
  invited: PlayerId[];
  signers: PlayerId[];
  seq: number | null;
  status: 'open' | 'correct' | 'wrong' | 'void';
}

interface Circular {
  round: number;
  proposer: PlayerId;
  gate: RegionCode;
  votes: Map<PlayerId, boolean>;
  passed?: boolean;
}

interface Suitcase {
  round: number;
  from: PlayerId;
  to: PlayerId;
  decoy: PlayerId;
  status: 'pending' | 'accepted' | 'refused';
}

interface NewsInstance {
  id: NewsId;
  region?: RegionCode;
  swap?: [PlayerId, PlayerId];
}

interface Step {
  from: RegionCode;
  to: RegionCode;
  how: 'move' | 'hawala' | 'tipoff' | 'forced';
}

interface RoundRec {
  round: number;
  news: NewsInstance | null;
  /** Where he stood when this round's night began (= his position during the previous round). */
  nightStart: RegionCode;
  /** Where he is during this round. */
  fugitive: RegionCode;
  steps: Step[];
  pinged: boolean;
  jeeps: Record<PlayerId, RegionCode>;
  suspended: Set<PlayerId>;
  clues: Map<PlayerId, ClueRec>;
  hotNoClue: Set<PlayerId>;
  delivered: boolean;
  press: Map<PlayerId, PressClaim>;
  published: boolean;
  stings: StingResult[];
  warrants: Warrant[];
  circular: Circular | null;
  suitcase: Suitcase | null;
  edQ: Map<PlayerId, EdQuestion>;
  itM: Map<PlayerId, Metric>;
  leakUsed: boolean;
  flushed: boolean;
}

interface NightInfo {
  from: RegionCode;
  flood?: RegionCode;
  flushed: boolean;
  maxSteps: number;
  mustMove: boolean;
  canFly: boolean;
  reach: RegionCode[];
}

export interface GameOptions {
  seed?: number;
  now?: () => number;
  /** Multiplies every phase length (tests use a tiny value). */
  timerScale?: number;
}

export type Result = { ok: true } | { ok: false; error: string };
const OK: Result = { ok: true };
const fail = (error: string): Result => ({ ok: false, error });

export class Game {
  readonly settings: Settings;
  readonly seats: Seat[];
  private rng: Rng;
  private clock: () => number;
  private scale: number;

  phase: Phase = 'deploy';
  round = 1;
  phaseEndsAt = 0;
  paused = false;
  private pausedRemaining = 0;

  private gates: RegionCode[];
  private sealed = new Set<RegionCode>();
  private circularsLeft: number;
  private fugitive: RegionCode;
  private readonly start: RegionCode;
  private visited = new Set<RegionCode>();
  private jeeps: Record<PlayerId, RegionCode | null> = {};
  private tools: { hawala: number; leaks: number; suitcaseUsed: boolean };
  private stingsLeft: number;
  private newsDeck: NewsId[];
  private rounds: RoundRec[] = [];
  private suspendNext = new Set<PlayerId>();
  private tipOffPending = false;
  private nightOrders: NightOrders | null = null;
  private nightOrdersBy: PlayerId | null = null;
  private nightOrdersLocked = false;
  private leakArmed: { by: PlayerId; target: PlayerId; clue: Clue } | null = null;
  private deployChoice = new Map<PlayerId, RegionCode>();
  private ready = new Set<PlayerId>();
  private bought = new Set<PlayerId>();
  private feed: FeedItem[] = [];
  private priv = new Map<PlayerId, PrivateItem[]>();
  private dms: Dm[] = [];
  private dmTimes = new Map<PlayerId, number[]>();
  private seq = 0;
  private warrantSeq = 0;
  private scoreEvents: { pid: PlayerId; points: number; reason: string }[] = [];
  private votes = new Map<PlayerId, PlayerId[]>();
  private report: Report | null = null;
  outcome: Outcome | null = null;

  constructor(players: { id: PlayerId; name: string }[], settings: Settings, opts: GameOptions = {}) {
    this.settings = { ...settings, agencies: [...settings.agencies] };
    this.rng = new Rng(opts.seed);
    this.clock = opts.now ?? Date.now;
    this.scale = opts.timerScale ?? 1;

    const agencies = this.rng.shuffle(this.settings.agencies);
    this.seats = players.map((p, i) => ({ id: p.id, name: p.name, agency: agencies[i], colour: COLOURS[i % COLOURS.length], mantri: false }));
    for (const i of this.rng.shuffle(this.seats.map((_, i) => i)).slice(0, this.settings.mantris)) this.seats[i].mantri = true;

    this.gates = gatesFor(this.settings.gates);
    this.circularsLeft = this.settings.circulars;
    this.start = this.fugitive = this.rng.pick(REGION_CODES.filter((c) => !this.gates.includes(c)));
    this.visited.add(this.fugitive);
    for (const s of this.seats) this.jeeps[s.id] = null;
    this.tools = { hawala: this.settings.hawala, leaks: this.settings.leaks, suitcaseUsed: !this.settings.suitcase };
    this.stingsLeft = this.seats.some((s) => s.agency === 'MEDIA') ? this.settings.stings : 0;
    this.newsDeck = this.rng.shuffle(NEWS_IDS);

    this.rounds.push(this.newRound(1, this.fugitive));
    this.addFeed('round', 'Round 1. Place your jeep anywhere on the map.');
    for (const s of this.seats.filter((x) => x.mantri)) {
      const partners = this.seats.filter((x) => x.mantri && x.id !== s.id).map((x) => x.name);
      this.privateMsg(
        s.id,
        'mantri',
        `You are Mantri ji. Bhagodalal is hiding in ${REGIONS[this.fugitive].name}.` +
          (partners.length ? ` Your partner Mantri: ${partners.join(', ')}.` : ''),
      );
    }
    this.enterPhase('deploy');
  }

  // ───────────────────────── helpers ─────────────────────────

  private get cur(): RoundRec {
    return this.rounds[this.rounds.length - 1];
  }
  private get prev(): RoundRec | null {
    return this.rounds.length >= 2 ? this.rounds[this.rounds.length - 2] : null;
  }
  seat(pid: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.id === pid);
  }
  private nameOf = (pid: PlayerId): string => this.seat(pid)?.name ?? 'Someone';
  private label = (pid: PlayerId): string => {
    const s = this.seat(pid);
    if (!s) return 'Someone';
    return this.settings.hiddenAgencies ? s.name : `${s.name} (${AGENCIES[s.agency].short})`;
  };
  private labels(ids: PlayerId[]): string {
    return ids.map(this.label).join(', ');
  }
  private mantriIds(): PlayerId[] {
    return this.seats.filter((s) => s.mantri).map((s) => s.id);
  }
  private openGates(): RegionCode[] {
    return this.gates.filter((g) => !this.sealed.has(g));
  }
  private hasSigned(pid: PlayerId): boolean {
    return this.cur.warrants.some((w) => w.signers.includes(pid));
  }

  private newRound(round: number, nightStart: RegionCode): RoundRec {
    return {
      round, news: null, nightStart, fugitive: nightStart, steps: [], pinged: false, jeeps: {}, suspended: new Set(),
      clues: new Map(), hotNoClue: new Set(), delivered: false, press: new Map(), published: false, stings: [],
      warrants: [], circular: null, suitcase: null, edQ: new Map(), itM: new Map(), leakUsed: false, flushed: false,
    };
  }

  private addFeed(kind: FeedKind, text: string, extra: Partial<FeedItem> = {}): void {
    this.feed.push({ id: ++this.seq, round: this.round, kind, text, ...extra });
  }

  private privateMsg(pid: PlayerId, kind: PrivateItem['kind'], text: string, extra: Partial<PrivateItem> = {}): void {
    const list = this.priv.get(pid) ?? [];
    list.push({ id: ++this.seq, round: this.round, kind, text, ...extra });
    this.priv.set(pid, list);
  }

  private mantriMsg(text: string): void {
    for (const id of this.mantriIds()) this.privateMsg(id, 'mantri', text);
  }

  private score(pid: PlayerId, points: number, reason: string): void {
    this.scoreEvents.push({ pid, points, reason });
  }

  private enterPhase(p: Phase): void {
    this.phase = p;
    this.ready.clear();
    if (p === 'report') {
      this.phaseEndsAt = 0;
      return;
    }
    this.phaseEndsAt = this.clock() + TIMERS[this.settings.timers][p] * 1000 * this.scale;
  }

  // ───────────────────────── clock ─────────────────────────

  /** Advance the phase if its timer ran out or everyone is done. Returns true if anything changed. */
  tick(): boolean {
    if (this.paused || this.phase === 'report') return false;
    if (this.clock() >= this.phaseEndsAt || this.earlyDone()) {
      this.advance();
      return true;
    }
    return false;
  }

  pause(): void {
    if (this.paused || this.phase === 'report') return;
    this.paused = true;
    this.pausedRemaining = Math.max(0, this.phaseEndsAt - this.clock());
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.phaseEndsAt = this.clock() + this.pausedRemaining;
  }

  private earlyDone(): boolean {
    const rr = this.cur;
    switch (this.phase) {
      case 'deploy':
        return this.seats.filter((s) => !rr.suspended.has(s.id)).every((s) => this.ready.has(s.id));
      case 'press':
        return [...rr.clues.keys()].every((id) => rr.press.has(id));
      case 'talk':
      case 'action':
        return this.seats.every((s) => this.ready.has(s.id));
      case 'inquiry':
        return this.seats.every((s) => this.votes.has(s.id));
      default:
        return false;
    }
  }

  private advance(): void {
    switch (this.phase) {
      case 'night': return this.resolveNight();
      case 'deploy': return this.resolveDeploy();
      case 'briefing': return this.finishBriefing();
      case 'press': return this.publishPress();
      case 'talk': return this.enterPhase('action');
      case 'action': return this.resolveAction();
      case 'inquiry': return this.finishInquiry();
      case 'report': return;
    }
  }

  // ───────────────────────── night ─────────────────────────

  private startNight(): void {
    this.round++;
    const rr = this.newRound(this.round, this.fugitive);
    rr.suspended = this.suspendNext;
    this.suspendNext = new Set();
    this.rounds.push(rr);
    this.addFeed('round', `Night falls. Round ${this.round} of ${this.settings.rounds}.`);
    if (rr.suspended.size) this.addFeed('suspend', `Suspended this round: ${this.labels([...rr.suspended])}.`);
    if (this.settings.news && this.newsDeck.length) {
      const id = this.newsDeck.shift()!;
      const n: NewsInstance = { id };
      if (id === 'MONSOON') n.region = this.rng.pick(REGION_CODES.filter((c) => REGIONS[c].coastal));
      if (id === 'MCC') n.region = this.rng.pick(REGION_CODES);
      if (id === 'TRANSFER') {
        const two = this.rng.shuffle(this.seats.map((s) => s.id)).slice(0, 2);
        n.swap = [two[0], two[1]];
      }
      if (id === 'HAWALA_BUST' && this.tools.hawala > 0) this.tools.hawala--;
      rr.news = n;
      this.addFeed('news', `📰 ${NEWS[id].title}${n.region ? ` in ${REGIONS[n.region].name}` : ''}. ${NEWS[id].text}`);
      if (id === 'CALLS') {
        const played = this.prev!;
        this.addFeed('calls', `📞 Call Records Leak: last round the closest jeep to him was ${this.labels(closestJeeps(played.fugitive, played.jeeps))}.`);
      }
    }
    this.enterPhase('night');
  }

  /** Movement facts for tonight (or, outside Night, a preview of the coming night without its news card). */
  private nightInfo(): NightInfo {
    const atNight = this.phase === 'night';
    const from = this.fugitive;
    const news = atNight ? this.cur.news : null;
    const flood = news?.id === 'MONSOON' ? news.region : undefined;
    const played = atNight ? this.prev : this.cur;
    const flushed = !!played?.flushed;
    const normal = !(news?.id === 'DIWALI' && !flushed);
    const maxSteps = (this.tipOffPending ? 1 : 0) + (normal ? 1 : 0);
    const canLeave = from !== flood && REGIONS[from].borders.some((b) => b !== flood);
    const reach = maxSteps > 0 && canLeave ? reachable(from, maxSteps, (c) => c === flood).filter((c) => c !== from) : [];
    return { from, flood, flushed, maxSteps, mustMove: flushed && canLeave && maxSteps > 0, canFly: this.canFly(), reach };
  }

  private canFly(): boolean {
    const atNight = this.phase === 'night';
    const nightRound = atNight ? this.round : this.round + 1;
    if (nightRound < this.settings.earliestEscape || nightRound > this.settings.rounds) return false;
    const F = this.fugitive;
    if (!this.gates.includes(F) || this.sealed.has(F)) return false;
    // At Night: the round just played. Otherwise a preview for the coming night (jeeps are only final after Deploy).
    const played = atNight ? this.prev : this.cur;
    if (!played || (!atNight && this.phase === 'deploy')) return false;
    if (Object.values(played.jeeps).includes(F)) return false;
    if (atNight && this.cur.news?.id === 'INTERPOL') return false;
    return true;
  }

  private suitcaseProblem(target: PlayerId, nightRound: number): string | null {
    if (!this.settings.suitcase) return 'The Suitcase is switched off.';
    if (this.tools.suitcaseUsed) return 'The Suitcase has already been used.';
    if (nightRound < 2 || nightRound > 5) return 'The Suitcase can only be sent on the nights of Rounds 2–5.';
    const t = this.seat(target);
    if (!t) return 'Unknown player.';
    if (t.mantri) return "You can't bribe a Mantri.";
    if (this.bought.has(target)) return 'They have already been bought.';
    return null;
  }

  /** The longest valid prefix of the requested steps. */
  private validSteps(steps: RegionCode[], info: NightInfo): RegionCode[] {
    const out: RegionCode[] = [];
    let at = info.from;
    for (const st of steps.slice(0, info.maxSteps)) {
      if (at === info.flood || st === info.flood || !areNeighbours(at, st)) break;
      out.push(st);
      at = st;
    }
    return out;
  }

  private ordersProblem(o: NightOrders): string | null {
    const info = this.nightInfo();
    if (o.fly) return info.canFly ? null : "He can't fly out tonight.";
    if (o.steps.length > info.maxSteps) return info.maxSteps === 0 ? "He can't move tonight." : `He can cross at most ${info.maxSteps} border${info.maxSteps > 1 ? 's' : ''} tonight.`;
    const ok = this.validSteps(o.steps, info);
    if (ok.length !== o.steps.length) return 'Each step must cross one open border.';
    const end = ok.length ? ok[ok.length - 1] : info.from;
    if (info.mustMove && end === info.from) return 'He was flushed out and must end the night somewhere else.';
    if (o.hawala) {
      const normalSteps = o.steps.length - (this.tipOffPending && o.steps.length > 0 ? 1 : 0);
      if (normalSteps < 1) return 'Hawala only hides a normal move.';
      if (this.tools.hawala < 1) return 'No Hawala moves left.';
    }
    if (o.suitcaseTarget) return this.suitcaseProblem(o.suitcaseTarget, this.round);
    return null;
  }

  private clearNight(): void {
    this.nightOrders = null;
    this.nightOrdersBy = null;
    this.nightOrdersLocked = false;
  }

  private resolveNight(): void {
    const rr = this.cur;
    const info = this.nightInfo();
    const o = this.nightOrders;

    if (o?.fly && info.canFly) {
      const F = this.fugitive;
      rr.fugitive = F;
      this.outcome = { type: 'escape', round: this.round, region: F };
      this.addFeed('escape', `✈ Bhagodalal flew out of India from ${REGIONS[F].gate!.name} (${REGIONS[F].name}).`);
      this.scoreOutcome([]);
      this.clearNight();
      this.enterPhase('inquiry');
      return;
    }

    let steps = o ? this.validSteps(o.steps, info) : [];
    let forced = false;
    const end = steps.length ? steps[steps.length - 1] : info.from;
    if (info.mustMove && end === info.from) {
      const options = REGIONS[info.from].borders.filter((b) => b !== info.flood);
      steps = [this.rng.pick(options)];
      forced = true;
    }

    let at = info.from;
    let hawalaUsed = false;
    steps.forEach((to, i) => {
      let how: Step['how'];
      if (forced) how = 'forced';
      else if (this.tipOffPending && i === 0) how = 'tipoff';
      else if (o?.hawala && this.tools.hawala > 0 && !hawalaUsed) {
        how = 'hawala';
        this.tools.hawala--;
        hawalaUsed = true;
      } else how = 'move';
      rr.steps.push({ from: at, to, how });
      this.visited.add(to);
      at = to;
    });
    this.fugitive = at;
    rr.fugitive = at;
    rr.pinged = rr.steps.some((s) => s.how === 'move' || s.how === 'forced') && rr.news?.id !== 'FASTAG';
    this.addFeed(rr.pinged ? 'ping' : 'noping', rr.pinged ? '📡 FASTag ping: Bhagodalal moved last night.' : 'No FASTag ping last night.');
    this.tipOffPending = false;

    if (o?.suitcaseTarget && this.nightOrdersBy && !this.suitcaseProblem(o.suitcaseTarget, this.round)) {
      const target = o.suitcaseTarget;
      let pool = this.seats.filter((s) => s.id !== target && !s.mantri).map((s) => s.id);
      if (!pool.length) pool = this.seats.filter((s) => s.id !== target).map((s) => s.id);
      rr.suitcase = { round: this.round, from: this.nightOrdersBy, to: target, decoy: this.rng.pick(pool), status: 'pending' };
      this.tools.suitcaseUsed = true;
      this.mantriMsg(`Suitcase sent to ${this.nameOf(target)}. They see it at the start of Thana Talk.`);
    }

    if (rr.news?.id === 'TRANSFER' && rr.news.swap) {
      const [a, b] = rr.news.swap;
      [this.jeeps[a], this.jeeps[b]] = [this.jeeps[b], this.jeeps[a]];
      this.addFeed('transfer', `🔁 Transfer Season: ${this.label(a)} and ${this.label(b)} swapped jeeps.`);
    }

    for (const b of this.bought) this.privateMsg(b, 'bought', `After the night, Bhagodalal is in ${REGIONS[at].name}.`);
    this.clearNight();
    this.enterPhase('deploy');
  }

  // ───────────────────────── deploy & briefing ─────────────────────────

  private deployOptions(pid: PlayerId): RegionCode[] | null {
    const rr = this.cur;
    if (rr.suspended.has(pid)) return null;
    const from = this.jeeps[pid];
    if (this.round === 1 || !from) return [...REGION_CODES];
    const news = rr.news;
    if (news?.id === 'BANDH') return [from];
    const flood = news?.id === 'MONSOON' ? news.region : undefined;
    const mcc = news?.id === 'MCC' ? news.region : undefined;
    return reachable(from, 2, (c) => c === flood || c === mcc, from === flood);
  }

  private resolveDeploy(): void {
    const rr = this.cur;
    for (const s of this.seats) {
      if (rr.suspended.has(s.id)) continue;
      const options = this.deployOptions(s.id)!;
      const choice = this.deployChoice.get(s.id);
      if (choice && options.includes(choice)) this.jeeps[s.id] = choice;
      else if (!this.jeeps[s.id]) this.jeeps[s.id] = this.rng.pick(REGION_CODES);
    }
    this.deployChoice.clear();
    rr.jeeps = { ...this.jeeps } as Record<PlayerId, RegionCode>;
    this.enterPhase('briefing');
    this.computeClues();
  }

  private computeClues(): void {
    const rr = this.cur;
    const F = this.fugitive;
    rr.flushed = Object.values(rr.jeeps).includes(F);
    const base = {
      F, nightStart: rr.nightStart, round: this.round, visited: this.visited, openGates: this.openGates(),
      allGates: this.gates, jeeps: this.jeeps, distance: this.settings.distance, rng: this.rng,
    };
    for (const s of this.seats) {
      if (rr.suspended.has(s.id)) continue;
      const jeep = this.jeeps[s.id]!;
      const hot = jeep === F;
      const clue = computeClue(s.agency, jeep, { ...base, edQuestion: rr.edQ.get(s.id), itMetric: rr.itM.get(s.id) });
      if (clue) rr.clues.set(s.id, { truth: clue, received: clue, planted: false, hot, from: jeep });
      else if (hot) rr.hotNoClue.add(s.id);
    }
  }

  private finishBriefing(): void {
    const rr = this.cur;
    const F = this.fugitive;
    if (this.leakArmed) {
      const L = this.leakArmed;
      this.leakArmed = null;
      const rec = rr.clues.get(L.target);
      let problem: string | null;
      if (this.tools.leaks < 1) problem = 'no Planted Leaks left';
      else if (rr.leakUsed) problem = 'only one leak per round';
      else if (!rec) problem = 'they have no clue this round';
      else if (rec.hot) problem = "their jeep is on him, and a leak can't hide a Hot Trail";
      else problem = leakProblem(L.clue, rec.truth, rec.from);
      if (problem || !rec) {
        this.mantriMsg(`Planted Leak on ${this.nameOf(L.target)} failed: ${problem}. It wasn't used up.`);
      } else {
        rec.received = L.clue;
        rec.planted = true;
        this.tools.leaks--;
        rr.leakUsed = true;
        this.mantriMsg(
          `Planted Leak delivered to ${this.nameOf(L.target)}: "${describeClue(L.clue, this.label)}". Their real clue was "${describeClue(rec.truth, this.label)}".`,
        );
      }
    }
    for (const [pid, rec] of rr.clues) {
      this.privateMsg(pid, 'clue', describeClue(rec.received, this.label), { clue: rec.received, from: rec.from });
      if (rec.hot) this.privateMsg(pid, 'hot', `🔥 Hot Trail! He is in ${REGIONS[rec.from].name} right now. He's flushed out and must move tonight.`);
    }
    for (const pid of rr.hotNoClue) {
      const j = this.jeeps[pid]!;
      this.privateMsg(pid, 'hot', `🔥 Hot Trail! He is in ${REGIONS[j].name} right now. He's flushed out and must move tonight.`);
    }
    rr.delivered = true;
    if (rr.news?.id === 'CCTV') this.addFeed('cctv', `📹 Viral CCTV: Bhagodalal is in the ${REGIONS[F].zone} zone.`);
    if (rr.news?.id === 'TIP') {
      const not = this.rng.shuffle(REGION_CODES.filter((c) => c !== F)).slice(0, 3);
      this.addFeed('tip', `🕵 Anonymous Tip: he is not in ${not.map((c) => REGIONS[c].name).join(', ')}.`);
    }
    this.enterPhase('press');
  }

  private publishPress(): void {
    const rr = this.cur;
    const rows: PressRow[] = [];
    for (const [pid, rec] of rr.clues) {
      if (!rr.press.has(pid)) rr.press.set(pid, { none: true });
      rows.push({ player: pid, claim: rr.press.get(pid)!, from: rec.from });
    }
    rr.published = true;
    this.addFeed('press', `Press Releases, Round ${this.round}`, { press: rows });
    this.enterPhase('talk');
  }

  // ───────────────────────── action ─────────────────────────

  private answerSuitcase(sc: Suitcase, accept: boolean): void {
    sc.status = accept ? 'accepted' : 'refused';
    if (accept) {
      this.bought.add(sc.to);
      this.privateMsg(
        sc.to,
        'suitcase',
        `You took the suitcase. You now play for Mantri ji (${this.mantriIds().map(this.nameOf).join(', ')}). Bhagodalal is in ${REGIONS[this.fugitive].name}, and you'll learn where he is after every night.`,
      );
      this.mantriMsg(`${this.nameOf(sc.to)} accepted the suitcase. They now know where he is and score with you.`);
    } else {
      this.score(sc.to, 2, 'Refused the Suitcase (Imaandar)');
      const pair = this.rng.shuffle([sc.from, sc.decoy]);
      this.privateMsg(sc.to, 'suitcase', `You refused the suitcase (+2 Imaandar). The offer came from ${this.nameOf(pair[0])} or ${this.nameOf(pair[1])}.`);
      this.mantriMsg(`${this.nameOf(sc.to)} refused the suitcase.`);
    }
  }

  private resolveAction(): void {
    const rr = this.cur;
    const F = this.fugitive;
    const executable = rr.warrants.filter((w) => w.signers.length >= 2).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    let arrested = false;
    const correct: Warrant[] = [];
    for (const w of executable) {
      if (w.region === F) {
        w.status = 'correct';
        correct.push(w);
        arrested = true;
        continue;
      }
      if (arrested) {
        w.status = 'void';
        continue;
      }
      w.status = 'wrong';
      for (const id of w.signers) {
        this.score(id, -3, `Wrong warrant on ${REGIONS[w.region].name}`);
        this.suspendNext.add(id);
      }
      this.tipOffPending = true;
      this.addFeed(
        'warrant',
        `⚖ Wrong warrant: ${this.labels(w.signers)} raided ${REGIONS[w.region].name}, but he wasn't there. Each signer loses 3 points and is suspended next round, and he gets a free silent tip-off move.`,
      );
    }
    for (const w of rr.warrants) if (w.status === 'open') w.status = 'void';

    if (arrested) {
      const by = [...new Set(correct.flatMap((w) => w.signers))];
      this.outcome = { type: 'arrest', round: this.round, region: F, by };
      this.addFeed('arrest', `🚔 Arrested! ${this.labels(by)} caught Bhagodalal in ${REGIONS[F].name}.`);
      this.scoreOutcome(correct);
      this.enterPhase('inquiry');
      return;
    }

    if (rr.circular) {
      const c = rr.circular;
      const active = this.seats.filter((s) => !rr.suspended.has(s.id));
      const yes = active.filter((s) => c.votes.get(s.id) === true).length;
      c.passed = yes > active.length / 2;
      const gate = `${REGIONS[c.gate].gate!.name} (${REGIONS[c.gate].name})`;
      if (c.passed) {
        this.sealed.add(c.gate);
        this.circularsLeft--;
        this.addFeed('circular', `🔒 Lookout Circular passed ${yes} of ${active.length}: ${gate} is sealed for the rest of the game.`);
      } else {
        this.addFeed('circular', `Lookout Circular for ${gate} failed: ${yes} of ${active.length} voted yes.`);
      }
    }

    if (rr.suitcase?.status === 'pending') this.answerSuitcase(rr.suitcase, false);

    if (this.round >= this.settings.rounds) {
      this.outcome = { type: 'survived', round: this.round, region: F };
      this.addFeed('survived', `⌛ Time's up. Bhagodalal is still free after Round ${this.round}.`);
      this.scoreOutcome([]);
      this.enterPhase('inquiry');
      return;
    }
    this.startNight();
  }

  private scoreOutcome(correct: Warrant[]): void {
    const o = this.outcome!;
    const traitors = new Set<PlayerId>([...this.mantriIds(), ...this.bought]);
    if (o.type === 'arrest') {
      const onWarrant = new Set<PlayerId>();
      for (const w of correct) {
        this.score(w.proposer, 7, 'Proposed the arrest warrant');
        onWarrant.add(w.proposer);
        for (const id of w.signers) {
          if (id === w.proposer) continue;
          this.score(id, 6, 'Co-signed the arrest warrant');
          onWarrant.add(id);
        }
      }
      for (const s of this.seats) if (!traitors.has(s.id) && !onWarrant.has(s.id)) this.score(s.id, 1, 'The agencies made the arrest');
      return;
    }
    const esc = o.type === 'escape';
    for (const s of this.seats) {
      if (s.mantri) this.score(s.id, esc ? 8 : 5, esc ? 'Bhagodalal escaped' : 'Bhagodalal stayed free');
      else if (this.bought.has(s.id)) this.score(s.id, esc ? 5 : 3, esc ? 'Bhagodalal escaped (Bought)' : 'Bhagodalal stayed free (Bought)');
    }
  }

  // ───────────────────────── inquiry & report ─────────────────────────

  private finishInquiry(): void {
    const mantris = this.mantriIds();
    const counts = new Map<PlayerId, number>();
    for (const [voter, targets] of this.votes) {
      for (const t of targets) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
        if (mantris.includes(t)) this.score(voter, 2, 'Named Mantri ji in the Inquiry');
      }
    }
    const maxOther = Math.max(0, ...this.seats.filter((s) => !s.mantri).map((s) => counts.get(s.id) ?? 0));
    for (const m of mantris) {
      if ((counts.get(m) ?? 0) > maxOther) this.score(m, -3, 'Exposed by the Inquiry');
      else this.score(m, 2, 'Clean chit from the Inquiry');
    }
    this.report = this.buildReport();
    this.enterPhase('report');
  }

  private scoreLines(): ScoreLine[] {
    const lines = this.seats.map((s) => {
      const ev = this.scoreEvents.filter((e) => e.pid === s.id);
      return {
        id: s.id,
        total: ev.reduce((a, e) => a + e.points, 0),
        events: ev.map((e) => ({ points: e.points, reason: e.reason })),
        wrong: ev.filter((e) => e.reason.startsWith('Wrong warrant')).length,
        named: ev.filter((e) => e.reason === 'Named Mantri ji in the Inquiry').length,
        rank: 0,
      };
    });
    lines.sort((a, b) => b.total - a.total || a.wrong - b.wrong || b.named - a.named);
    lines.forEach((l, i) => {
      const p = lines[i - 1];
      l.rank = p && p.total === l.total && p.wrong === l.wrong && p.named === l.named ? p.rank : i + 1;
    });
    return lines.map(({ id, total, events, rank }) => ({ id, total, events, rank }));
  }

  private warrantView(w: Warrant): WarrantView {
    return { id: w.id, round: w.round, proposer: w.proposer, region: w.region, invited: [...w.invited], signers: [...w.signers], status: w.status };
  }

  private circularView(c: Circular): CircularView {
    return { round: c.round, proposer: c.proposer, gate: c.gate, votes: Object.fromEntries(c.votes), passed: c.passed };
  }

  private buildReport(): Report {
    const lies: Record<PlayerId, number> = Object.fromEntries(this.seats.map((s) => [s.id, 0]));
    let leaksUsed = 0;
    let leaksUnnoticed = 0;
    const rounds: ReportRound[] = this.rounds.map((rr) => {
      const releases = [...rr.clues.entries()].map(([pid, rec]) => {
        const claim = rr.press.get(pid) ?? { none: true as const };
        let label: 'True' | 'Lie' | 'Planted' | 'No comment';
        if (claim.none) label = 'No comment';
        else if (sameClue(claim.clue, rec.received) && claim.hot === rec.hot) label = rec.planted ? 'Planted' : 'True';
        else label = 'Lie';
        if (label === 'Lie') lies[pid]++;
        if (rec.planted) {
          leaksUsed++;
          if (label === 'Planted') leaksUnnoticed++;
        }
        return { player: pid, from: rec.from, received: rec.received, hot: rec.hot, claim, label, planted: rec.planted };
      });
      return {
        round: rr.round,
        news: rr.news ? { id: rr.news.id, title: NEWS[rr.news.id].title, region: rr.news.region } : null,
        fugitive: rr.fugitive,
        steps: rr.steps.map((s) => ({ ...s })),
        pinged: rr.pinged,
        jeeps: { ...rr.jeeps },
        releases: rr.published ? releases : [],
        warrants: rr.warrants.map((w) => this.warrantView(w)),
        circular: rr.circular ? this.circularView(rr.circular) : null,
        suitcase: rr.suitcase ? { from: rr.suitcase.from, to: rr.suitcase.to, status: rr.suitcase.status } : null,
        stings: rr.stings.map((s) => ({ ...s })),
      };
    });
    return {
      outcome: this.outcome!,
      start: this.start,
      roles: this.seats.map((s) => ({
        id: s.id, name: s.name, agency: s.agency, colour: s.colour,
        role: (s.mantri ? 'mantri' : this.bought.has(s.id) ? 'bought' : 'agency') as Role,
      })),
      rounds,
      scores: this.scoreLines(),
      votes: Object.fromEntries(this.votes),
      stats: {
        roundsPlayed: this.round,
        pings: this.rounds.filter((r) => r.pinged).length,
        hawalaUsed: this.rounds.reduce((a, r) => a + r.steps.filter((s) => s.how === 'hawala').length, 0),
        leaksUsed,
        leaksUnnoticed,
        lies,
      },
    };
  }

  // ───────────────────────── actions ─────────────────────────

  act(pid: PlayerId, a: GameAction): Result {
    const s = this.seat(pid);
    if (!s) return fail('You are not in this game.');
    if (!a || typeof a !== 'object') return fail('Bad request.');
    if (a.type === 'dm') return this.sendDm(pid, a.to, a.text);
    if (this.phase === 'report') return fail('The game is over.');
    if (this.paused) return fail('The game is paused.');
    const rr = this.cur;
    const suspended = rr.suspended.has(pid);

    switch (a.type) {
      case 'deploy': {
        if (this.phase !== 'deploy') return fail('You can only move your jeep during Deploy.');
        const options = this.deployOptions(pid);
        if (!options) return fail('You are suspended this round.');
        if (!isRegionCode(a.region) || !options.includes(a.region)) return fail("Your jeep can't reach that region this round.");
        this.deployChoice.set(pid, a.region);
        return OK;
      }
      case 'edQuestion': {
        if (this.phase !== 'deploy') return fail('Pick your question during Deploy.');
        if (s.agency !== 'ED') return fail('Only ED asks questions.');
        if (!validEdQuestion(a.question)) return fail('Pick a question from the list.');
        rr.edQ.set(pid, a.question);
        return OK;
      }
      case 'itMetric': {
        if (this.phase !== 'deploy') return fail('Pick your comparison during Deploy.');
        if (s.agency !== 'IT') return fail('Only Income Tax compares regions.');
        if (a.metric !== 'seats' && a.metric !== 'neighbours') return fail('Pick seats or neighbours.');
        rr.itM.set(pid, a.metric);
        return OK;
      }
      case 'ready': {
        if (this.phase !== 'deploy' && this.phase !== 'talk' && this.phase !== 'action') return fail('Nothing to confirm right now.');
        if (a.ready) this.ready.add(pid);
        else this.ready.delete(pid);
        return OK;
      }
      case 'press': {
        if (this.phase !== 'press') return fail('Press Releases go out during the Press Release phase.');
        const rec = rr.clues.get(pid);
        if (!rec) return fail('You have no clue to report this round.');
        const raw = a.claim as Record<string, unknown> | undefined;
        if (raw && raw.none === true) {
          rr.press.set(pid, { none: true });
          return OK;
        }
        const clue = cleanClue(raw?.clue, this.seats.map((x) => x.id), this.settings.distance);
        if (!clue) return fail("That isn't a valid clue.");
        const allowed = this.settings.hiddenAgencies || clue.kind === AGENCY_CLUE[s.agency];
        if (!allowed) return fail(`Use the ${AGENCIES[s.agency].name} clue format.`);
        rr.press.set(pid, { clue, hot: raw?.hot === true });
        return OK;
      }
      case 'sting': {
        if (this.phase !== 'talk') return fail('Stings happen during Thana Talk.');
        if (s.agency !== 'MEDIA') return fail('Only Media can run a Sting.');
        if (this.stingsLeft < 1) return fail('No Stings left.');
        if (rr.stings.length) return fail('Only one Sting per round.');
        const rec = rr.clues.get(a.target);
        if (!rec) return fail('That agency has no clue this round.');
        const claim = rr.press.get(a.target) ?? { none: true as const };
        const verdict: StingResult['verdict'] = claim.none
          ? 'NO COMMENT'
          : sameClue(claim.clue, rec.received) && claim.hot === rec.hot
            ? 'MATCH'
            : 'MISMATCH';
        const res: StingResult = { round: this.round, by: pid, target: a.target, received: rec.received, hot: rec.hot, claim, verdict };
        rr.stings.push(res);
        this.stingsLeft--;
        this.addFeed('sting', `🎥 Sting on ${this.label(a.target)}: ${verdict}.`, { sting: res });
        if (verdict === 'MISMATCH') this.score(pid, 2, 'Sting exposed a MISMATCH');
        else if (verdict === 'NO COMMENT') this.score(pid, 1, 'Sting exposed a NO COMMENT');
        return OK;
      }
      case 'warrantPropose': {
        if (this.phase !== 'action') return fail('Warrants are proposed during Action.');
        if (rr.news?.id === 'COURT') return fail('Court Stay: no warrants this round.');
        if (s.agency === 'MEDIA') return fail("Media can't sign warrants.");
        if (suspended) return fail('You are suspended this round.');
        if (this.hasSigned(pid)) return fail('You have already signed a warrant this round.');
        if (!isRegionCode(a.region)) return fail('Pick a region.');
        const invite = Array.isArray(a.invite) ? [...new Set(a.invite)] : [];
        if (invite.length < 1 || invite.length > 2) return fail('Invite 1 or 2 co-signers.');
        for (const id of invite) {
          const t = this.seat(id);
          if (!t || id === pid) return fail('Pick other agencies as co-signers.');
          // In Hidden agencies mode an invite to Media is allowed (refusing it would reveal who Media is); Media just can't accept.
          if (t.agency === 'MEDIA' && !this.settings.hiddenAgencies) return fail("Media can't sign warrants.");
          if (rr.suspended.has(id)) return fail(`${t.name} is suspended this round.`);
        }
        rr.warrants.push({
          id: `w${this.round}-${rr.warrants.length + 1}`, round: this.round, proposer: pid, region: a.region,
          invited: invite, signers: [pid], seq: null, status: 'open',
        });
        return OK;
      }
      case 'warrantRespond': {
        if (this.phase !== 'action') return fail('Warrants are signed during Action.');
        const w = rr.warrants.find((x) => x.id === a.warrantId);
        if (!w || !w.invited.includes(pid)) return fail('That invitation is no longer open.');
        if (a.accept) {
          if (s.agency === 'MEDIA') return fail("Media can't sign warrants.");
          if (this.hasSigned(pid)) return fail('You have already signed a warrant this round.');
          if (rr.news?.id === 'COURT') return fail('Court Stay: no warrants this round.');
          w.signers.push(pid);
          if (w.signers.length === 2 && w.seq === null) w.seq = ++this.warrantSeq;
        }
        w.invited = w.invited.filter((x) => x !== pid);
        return OK;
      }
      case 'circularPropose': {
        if (this.phase !== 'action') return fail('Circulars are proposed during Action.');
        if (suspended) return fail('You are suspended this round.');
        if (rr.circular) return fail('A circular is already up for a vote this round.');
        if (this.circularsLeft < 1) return fail('No Lookout Circulars left.');
        if (!isRegionCode(a.gate) || !this.gates.includes(a.gate)) return fail("That isn't an exit gate.");
        if (this.sealed.has(a.gate)) return fail('That gate is already sealed.');
        rr.circular = { round: this.round, proposer: pid, gate: a.gate, votes: new Map([[pid, true]]) };
        this.addFeed('circularProposed', `${this.label(pid)} proposes a Lookout Circular to seal ${REGIONS[a.gate].gate!.name} (${REGIONS[a.gate].name}).`);
        return OK;
      }
      case 'circularVote': {
        if (this.phase !== 'action' || !rr.circular) return fail('There is no circular to vote on.');
        if (suspended) return fail("Suspended agencies can't vote.");
        rr.circular.votes.set(pid, a.yes === true);
        return OK;
      }
      case 'suitcaseRespond': {
        const sc = rr.suitcase;
        if (!sc || sc.to !== pid || sc.status !== 'pending') return fail('No suitcase is waiting for you.');
        if (this.phase !== 'talk' && this.phase !== 'action') return fail('Answer during Thana Talk or Action.');
        this.answerSuitcase(sc, a.accept === true);
        return OK;
      }
      case 'nightOrders': {
        if (!s.mantri) return fail('Only Mantri ji gives night orders.');
        const pre = this.phase === 'talk' || this.phase === 'action';
        if (this.phase !== 'night' && !pre) return fail('Night orders can be set during Thana Talk, Action or Night.');
        if (pre && this.round >= this.settings.rounds) return fail('There is no night left.');
        if (this.nightOrdersLocked && this.nightOrdersBy !== pid) return fail('Your partner has already locked tonight’s orders.');
        const o = a.orders as Partial<NightOrders> | undefined;
        const steps = Array.isArray(o?.steps) ? o!.steps.filter(isRegionCode).slice(0, 2) : [];
        if (Array.isArray(o?.steps) && steps.length !== o!.steps.length) return fail('Bad route.');
        const clean: NightOrders = {
          steps,
          hawala: o?.hawala === true,
          fly: o?.fly === true,
          suitcaseTarget: typeof o?.suitcaseTarget === 'string' && o.suitcaseTarget ? o.suitcaseTarget : undefined,
        };
        if (clean.suitcaseTarget && !this.seat(clean.suitcaseTarget)) return fail('Unknown player.');
        if (this.phase === 'night') {
          const problem = this.ordersProblem(clean);
          if (problem) return fail(problem);
        }
        this.nightOrders = clean;
        this.nightOrdersBy = pid;
        if (this.settings.mantris === 2) this.nightOrdersLocked = true;
        return OK;
      }
      case 'leakArm': {
        if (!s.mantri) return fail('Only Mantri ji can plant leaks.');
        if (this.phase !== 'deploy' && this.phase !== 'briefing') return fail('Leaks are planted during Deploy or Briefing.');
        if (this.tools.leaks < 1) return fail('No Planted Leaks left.');
        if (rr.leakUsed) return fail('Only one leak per round.');
        const t = this.seat(a.target);
        if (!t || t.mantri || t.agency === 'MEDIA') return fail('Pick another agency to leak to.');
        if (rr.suspended.has(a.target)) return fail('They are suspended this round.');
        const clue = cleanClue(a.clue, this.seats.map((x) => x.id), this.settings.distance);
        if (!clue) return fail("That isn't a valid clue.");
        if (clue.kind !== AGENCY_CLUE[t.agency]) return fail(`The fake must use the ${AGENCIES[t.agency].name} format.`);
        if (this.phase === 'briefing') {
          const rec = rr.clues.get(a.target);
          if (rec?.hot) return fail("Their jeep is on him: a leak can't hide a Hot Trail.");
          const problem = rec ? leakProblem(clue, rec.truth, rec.from) : null;
          if (problem) return fail(problem);
        } else {
          // Their jeep isn't final yet: only the format rules can be checked now. The rest is checked at Briefing.
          const problem = leakProblem(clue, clue, null);
          if (problem) return fail(problem);
        }
        this.leakArmed = { by: pid, target: a.target, clue };
        return OK;
      }
      case 'leakDisarm': {
        if (!s.mantri) return fail('Only Mantri ji can plant leaks.');
        this.leakArmed = null;
        return OK;
      }
      case 'inquiryVote': {
        if (this.phase !== 'inquiry') return fail('Voting happens during the Inquiry.');
        const picks = this.settings.mantris;
        const targets = Array.isArray(a.targets) ? [...new Set(a.targets)] : [];
        if (targets.length !== picks) return fail(`Name ${picks} player${picks > 1 ? 's' : ''}.`);
        if (targets.some((t) => t === pid || !this.seat(t))) return fail("You can't vote for yourself.");
        this.votes.set(pid, targets);
        return OK;
      }
      default:
        return fail('Unknown action.');
    }
  }

  private sendDm(pid: PlayerId, to: PlayerId, text: unknown): Result {
    const body = typeof text === 'string' ? text.trim().slice(0, 300) : '';
    if (!body) return fail('Write a message first.');
    if (!this.seat(to) || to === pid) return fail('Pick someone to message.');
    const now = this.clock();
    const recent = (this.dmTimes.get(pid) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 10) return fail('Slow down a little.');
    recent.push(now);
    this.dmTimes.set(pid, recent);
    this.dms.push({ id: ++this.seq, round: this.round, from: pid, to, text: body, at: now });
    return OK;
  }

  // ───────────────────────── views ─────────────────────────

  private mantriView(pid: PlayerId): MantriView {
    const rr = this.cur;
    const info = this.nightInfo();
    const nightRound = this.phase === 'night' ? this.round : this.round + 1;
    const lastCase = [...this.rounds].reverse().find((r) => r.suitcase)?.suitcase ?? null;
    return {
      partners: this.mantriIds().filter((id) => id !== pid),
      bought: [...this.bought],
      fugitive: this.fugitive,
      route: this.rounds.map((r) => ({ round: r.round, region: r.fugitive })),
      visited: [...this.visited],
      hawalaLeft: this.tools.hawala,
      leaksLeft: this.tools.leaks,
      suitcaseAvailable: this.settings.suitcase && !this.tools.suitcaseUsed && nightRound >= 2 && nightRound <= 5 && nightRound <= this.settings.rounds,
      suitcaseUsed: this.tools.suitcaseUsed,
      canFly: info.canFly,
      flushed: info.flushed,
      tipOffPending: this.tipOffPending,
      reachable: info.reach,
      maxSteps: info.maxSteps,
      mustMove: info.mustMove,
      orders: this.nightOrders ? { ...this.nightOrders, steps: [...this.nightOrders.steps] } : null,
      ordersBy: this.nightOrdersBy,
      ordersLocked: this.nightOrdersLocked,
      leakArmed: this.leakArmed ? { target: this.leakArmed.target, clue: this.leakArmed.clue } : null,
      leakUsedThisRound: rr.leakUsed,
      edQuestions: Object.fromEntries(rr.edQ),
      itMetrics: Object.fromEntries(rr.itM),
      suitcase: lastCase ? { target: lastCase.to, status: lastCase.status, round: lastCase.round } : null,
    };
  }

  viewFor(pid: PlayerId, meta: { connected: Record<PlayerId, boolean>; hostId: PlayerId }): GameView {
    const s = this.seat(pid)!;
    const rr = this.cur;
    const hidden = this.settings.hiddenAgencies;
    const role: Role = s.mantri ? 'mantri' : this.bought.has(pid) ? 'bought' : 'agency';
    const rec = rr.clues.get(pid);
    const sc = rr.suitcase;
    const showOffer = sc && sc.to === pid && (this.phase === 'talk' || this.phase === 'action' || sc.status !== 'pending');
    const news = rr.news;
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.settings.rounds,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this.clock(),
      paused: this.paused,
      pausedRemaining: this.pausedRemaining,
      settings: { ...this.settings, agencies: hidden ? [] : [...this.settings.agencies] },
      me: { id: pid, agency: s.agency, role, suspended: rr.suspended.has(pid), ready: this.ready.has(pid) },
      players: this.seats.map((p) => ({
        id: p.id,
        name: p.name,
        colour: p.colour,
        connected: meta.connected[p.id] ?? false,
        isHost: p.id === meta.hostId,
        // Hidden agencies: you only see your own, except Mantri ji, whose insider knowledge covers every agency.
        agency: hidden && p.id !== pid && role !== 'mantri' ? undefined : p.agency,
        jeep: this.jeeps[p.id],
        suspended: rr.suspended.has(p.id),
        ready: this.ready.has(p.id),
        posted: rr.press.has(p.id),
      })),
      gates: this.gates.map((code) => ({ code, sealed: this.sealed.has(code) })),
      circularsLeft: this.circularsLeft,
      news: news ? { id: news.id, title: NEWS[news.id].title, text: NEWS[news.id].text, region: news.region } : null,
      blocked: {
        flood: news?.id === 'MONSOON' ? news.region : undefined,
        mcc: news?.id === 'MCC' ? news.region : undefined,
      },
      deployOptions: this.phase === 'deploy' ? this.deployOptions(pid) : null,
      myDeploy: this.deployChoice.get(pid) ?? null,
      myEdQuestion: s.agency === 'ED' ? rr.edQ.get(pid) ?? null : null,
      myItMetric: s.agency === 'IT' ? rr.itM.get(pid) ?? null : null,
      myClue: rec && rr.delivered ? { clue: rec.received, hot: rec.hot, from: rec.from } : null,
      myPress: rr.press.get(pid) ?? null,
      press: rr.published
        ? [...rr.clues.entries()].map(([id, c]) => ({ player: id, claim: rr.press.get(id) ?? { none: true }, from: c.from }))
        : [],
      stingsLeft: this.stingsLeft,
      stingUsedThisRound: rr.stings.length > 0,
      warrants: rr.warrants
        .filter((w) => w.status === 'correct' || w.status === 'wrong' || w.proposer === pid || w.invited.includes(pid) || w.signers.includes(pid))
        .map((w) => this.warrantView(w)),
      signedThisRound: this.hasSigned(pid),
      circular: rr.circular ? this.circularView(rr.circular) : null,
      suitcaseOffer: showOffer ? { status: sc!.status } : null,
      feed: this.feed,
      private: this.priv.get(pid) ?? [],
      dms: this.dms.filter((d) => d.from === pid || d.to === pid),
      mantri: role === 'mantri' ? this.mantriView(pid) : null,
      bought: role === 'bought' ? { mantris: this.mantriIds(), fugitive: this.fugitive } : null,
      inquiry:
        this.phase === 'inquiry' || this.phase === 'report'
          ? { myVote: this.votes.get(pid) ?? [], voted: this.votes.size, needed: this.seats.length, picks: this.settings.mantris }
          : null,
      outcome: this.outcome,
      report: this.phase === 'report' ? this.report : null,
    };
  }

  // ───────────────────────── test hooks ─────────────────────────

  /** For tests and the simulator only. Never sent to clients. */
  debugState() {
    return {
      fugitive: this.fugitive,
      jeeps: { ...this.jeeps },
      mantris: this.mantriIds(),
      bought: [...this.bought],
      tools: { ...this.tools },
      sealed: [...this.sealed],
      tipOffPending: this.tipOffPending,
      scoreEvents: [...this.scoreEvents],
      rounds: this.rounds,
    };
  }

  /** Force the clock forward to the end of the current phase (tests). */
  expirePhase(): void {
    this.phaseEndsAt = this.clock() - 1;
  }

  /** Tests only: move the fugitive and/or jeeps. */
  debugSet(opts: { fugitive?: RegionCode; jeeps?: Record<PlayerId, RegionCode> }): void {
    if (opts.fugitive) {
      this.fugitive = opts.fugitive;
      this.cur.fugitive = opts.fugitive;
      this.visited.add(opts.fugitive);
    }
    if (opts.jeeps) {
      Object.assign(this.jeeps, opts.jeeps);
      if (Object.keys(this.cur.jeeps).length) Object.assign(this.cur.jeeps, opts.jeeps);
    }
  }
}
