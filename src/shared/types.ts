import type { AgencyId } from './agencies';
import type { Dir } from './graph';
import type { NewsId } from './news';
import type { Country, RegionCode, Zone } from './regions';
import type { Settings, SettingsCheck } from './settings';

export type PlayerId = string;

export type EdQuestion =
  | { q: 'coastal' }
  | { q: 'borders'; country: Country }
  | { q: 'zone'; zone: Zone }
  | { q: 'hindi' }
  | { q: 'seats'; n: number }
  | { q: 'neighbours'; n: number }
  | { q: 'gate' }
  | { q: 'sameZone' };

export type Metric = 'seats' | 'neighbours';
export type CbiBand = 'Here' | '1–2' | '3–4' | '5+';
export const CBI_BANDS: CbiBand[] = ['Here', '1–2', '3–4', '5+'];

export type Clue =
  | { kind: 'CBI'; value: number | CbiBand }
  | { kind: 'NIA'; value: Dir | 'Here' }
  | { kind: 'CYBER'; value: RegionCode[] | 'No signal' }
  | { kind: 'POLICE'; value: boolean }
  | { kind: 'CRIME'; value: 'Now' | 'Earlier' | 'Never' }
  | { kind: 'ED'; question: EdQuestion; value: boolean }
  | { kind: 'IT'; metric: Metric; value: 'More' | 'Fewer' | 'Same' }
  | { kind: 'CUSTOMS'; value: number }
  | { kind: 'RPF'; value: Dir | 'Did not move' | 'No movement yet' }
  | { kind: 'RAW'; value: Zone }
  | { kind: 'IB'; value: PlayerId[] };

export type ClueKind = Clue['kind'];

export type PressClaim = { none: true } | { none?: false; clue: Clue; hot: boolean };

export type Phase = 'night' | 'deploy' | 'briefing' | 'press' | 'talk' | 'action' | 'inquiry' | 'report';

export type Role = 'agency' | 'mantri' | 'bought';

export interface StingResult {
  round: number;
  by: PlayerId;
  target: PlayerId;
  received: Clue;
  hot: boolean;
  claim: PressClaim;
  verdict: 'MATCH' | 'MISMATCH' | 'NO COMMENT';
}

export interface PressRow {
  player: PlayerId;
  claim: PressClaim;
  from: RegionCode | null;
}

export type FeedKind =
  | 'round' | 'news' | 'ping' | 'noping' | 'press' | 'sting' | 'warrant' | 'circular' | 'circularProposed'
  | 'escape' | 'arrest' | 'survived' | 'transfer' | 'cctv' | 'tip' | 'calls' | 'suspend' | 'info';

export interface FeedItem {
  id: number;
  round: number;
  kind: FeedKind;
  text: string;
  press?: PressRow[];
  sting?: StingResult;
}

export interface PrivateItem {
  id: number;
  round: number;
  kind: 'clue' | 'hot' | 'suitcase' | 'leak' | 'bought' | 'info' | 'mantri';
  text: string;
  clue?: Clue;
  from?: RegionCode;
}

export interface Dm {
  id: number;
  round: number;
  from: PlayerId;
  to: PlayerId;
  text: string;
  at: number;
}

export interface WarrantView {
  id: string;
  round: number;
  proposer: PlayerId;
  region: RegionCode;
  invited: PlayerId[];
  signers: PlayerId[];
  status: 'open' | 'correct' | 'wrong' | 'void';
}

export interface CircularView {
  round: number;
  proposer: PlayerId;
  gate: RegionCode;
  votes: Record<PlayerId, boolean>;
  passed?: boolean;
}

export interface NightOrders {
  steps: RegionCode[];
  hawala: boolean;
  fly: boolean;
  suitcaseTarget?: PlayerId;
}

export interface PlayerPublic {
  id: PlayerId;
  name: string;
  colour: string;
  connected: boolean;
  isHost: boolean;
  /** Omitted for other players in Hidden agencies mode. */
  agency?: AgencyId;
  jeep: RegionCode | null;
  suspended: boolean;
  ready: boolean;
  posted: boolean;
}

export interface MantriView {
  partners: PlayerId[];
  bought: PlayerId[];
  fugitive: RegionCode;
  route: { round: number; region: RegionCode }[];
  visited: RegionCode[];
  hawalaLeft: number;
  leaksLeft: number;
  suitcaseAvailable: boolean;
  suitcaseUsed: boolean;
  canFly: boolean;
  flushed: boolean;
  tipOffPending: boolean;
  /** Regions he may reach tonight (excluding where he is), given the steps allowed. */
  reachable: RegionCode[];
  maxSteps: number;
  mustMove: boolean;
  orders: NightOrders | null;
  ordersBy: PlayerId | null;
  ordersLocked: boolean;
  leakArmed: { target: PlayerId; clue: Clue } | null;
  leakUsedThisRound: boolean;
  /** Other agencies' current ED question / Income Tax metric, for crafting a believable leak. */
  edQuestions: Record<PlayerId, EdQuestion>;
  itMetrics: Record<PlayerId, Metric>;
  suitcase: { target: PlayerId; status: 'pending' | 'accepted' | 'refused'; round: number } | null;
}

export interface Outcome {
  type: 'arrest' | 'escape' | 'survived';
  round: number;
  region: RegionCode;
  by?: PlayerId[];
}

export interface ReportRelease {
  player: PlayerId;
  from: RegionCode | null;
  received: Clue | null;
  hot: boolean;
  claim: PressClaim;
  label: 'True' | 'Lie' | 'Planted' | 'No comment';
  planted: boolean;
}

export interface ReportRound {
  round: number;
  news: { id: NewsId; title: string; region?: RegionCode } | null;
  fugitive: RegionCode;
  steps: { from: RegionCode; to: RegionCode; how: 'move' | 'hawala' | 'tipoff' | 'forced' }[];
  pinged: boolean;
  jeeps: Record<PlayerId, RegionCode>;
  releases: ReportRelease[];
  warrants: WarrantView[];
  circular: CircularView | null;
  suitcase: { from: PlayerId; to: PlayerId; status: 'pending' | 'accepted' | 'refused' } | null;
  stings: StingResult[];
}

export interface ScoreLine {
  id: PlayerId;
  total: number;
  rank: number;
  events: { points: number; reason: string }[];
}

export interface Report {
  outcome: Outcome;
  start: RegionCode;
  roles: { id: PlayerId; name: string; agency: AgencyId; role: Role; colour: string }[];
  rounds: ReportRound[];
  scores: ScoreLine[];
  votes: Record<PlayerId, PlayerId[]>;
  stats: {
    roundsPlayed: number;
    pings: number;
    hawalaUsed: number;
    leaksUsed: number;
    leaksUnnoticed: number;
    lies: Record<PlayerId, number>;
  };
}

export interface GameView {
  phase: Phase;
  round: number;
  rounds: number;
  phaseEndsAt: number;
  serverNow: number;
  paused: boolean;
  pausedRemaining: number;
  settings: Settings;
  me: { id: PlayerId; agency: AgencyId; role: Role; suspended: boolean; ready: boolean };
  players: PlayerPublic[];
  gates: { code: RegionCode; sealed: boolean }[];
  circularsLeft: number;
  news: { id: NewsId; title: string; text: string; region?: RegionCode } | null;
  blocked: { flood?: RegionCode; mcc?: RegionCode };
  deployOptions: RegionCode[] | null;
  myDeploy: RegionCode | null;
  myEdQuestion: EdQuestion | null;
  myItMetric: Metric | null;
  myClue: { clue: Clue; hot: boolean; from: RegionCode } | null;
  myPress: PressClaim | null;
  press: PressRow[];
  stingsLeft: number;
  stingUsedThisRound: boolean;
  warrants: WarrantView[];
  signedThisRound: boolean;
  circular: CircularView | null;
  suitcaseOffer: { status: 'pending' | 'accepted' | 'refused' } | null;
  feed: FeedItem[];
  private: PrivateItem[];
  dms: Dm[];
  mantri: MantriView | null;
  bought: { mantris: PlayerId[]; fugitive: RegionCode } | null;
  inquiry: { myVote: PlayerId[]; voted: number; needed: number; picks: number } | null;
  outcome: Outcome | null;
  report: Report | null;
}

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  connected: boolean;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  me: PlayerId;
  hostId: PlayerId;
  stage: 'lobby' | 'game';
  players: LobbyPlayer[];
  settings: Settings;
  check: SettingsCheck;
  balance: number;
  game: GameView | null;
  claims: { id: string; name: string; seat: PlayerId }[];
}

export type GameAction =
  | { type: 'deploy'; region: RegionCode }
  | { type: 'edQuestion'; question: EdQuestion }
  | { type: 'itMetric'; metric: Metric }
  | { type: 'ready'; ready: boolean }
  | { type: 'press'; claim: PressClaim }
  | { type: 'sting'; target: PlayerId }
  | { type: 'warrantPropose'; region: RegionCode; invite: PlayerId[] }
  | { type: 'warrantRespond'; warrantId: string; accept: boolean }
  | { type: 'circularPropose'; gate: RegionCode }
  | { type: 'circularVote'; yes: boolean }
  | { type: 'suitcaseRespond'; accept: boolean }
  | { type: 'nightOrders'; orders: NightOrders }
  | { type: 'leakArm'; target: PlayerId; clue: Clue }
  | { type: 'leakDisarm' }
  | { type: 'inquiryVote'; targets: PlayerId[] }
  | { type: 'dm'; to: PlayerId; text: string };

export type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; data?: unknown };
