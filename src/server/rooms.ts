import { randomBytes } from 'node:crypto';
import { Game } from '../engine/game';
import { houseBotActions, newBotMemory, type BotMemory } from '../engine/houseBot';
import { Rng } from '../shared/rng';
import {
  MAX_PLAYERS, PRESETS, balanceEstimate, checkSettings, defaultSettings, sanitizeSettings, suggestedAgencies,
  type Settings,
} from '../shared/settings';
import type { Ack, GameAction, PlayerId, RoomView } from '../shared/types';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const HOST_HANDOVER_MS = 30_000;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;

export interface Member {
  id: PlayerId;
  name: string;
  token: string;
  sockets: Set<string>;
  lastSeen: number;
  /** Present for house bots, which the server plays itself. */
  bot?: { rng: Rng; mem: BotMemory; phaseKey: string; nextAt: number };
}

const BOT_NAMES = ['Arjun', 'Priya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vikram', 'Isha', 'Dev', 'Zoya'];
/** How long a bot "thinks" before acting in each phase, in seconds [min, max]. */
const BOT_DELAY: Record<string, [number, number]> = {
  night: [1.5, 3], deploy: [1.5, 4], press: [1.5, 4], talk: [3, 7], action: [2, 5], inquiry: [2, 5],
};

interface Claim {
  id: string;
  name: string;
  seat: PlayerId;
  socketId: string;
}

const ok = <T>(data?: T): Ack<T> => ({ ok: true, data });
const err = (error: string): Ack<never> => ({ ok: false, error });

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return s.slice(0, 16);
}

export class Room {
  readonly code: string;
  hostId: PlayerId = '';
  members: Member[] = [];
  settings: Settings = defaultSettings();
  /** False until the host edits the agency list; until then it follows the player count. */
  agenciesTouched = false;
  game: Game | null = null;
  claims: Claim[] = [];
  lastActive = Date.now();
  private hostAwaySince: number | null = null;

  constructor(code: string, private readonly timerScale: number) {
    this.code = code;
  }

  get stage(): 'lobby' | 'game' {
    return this.game ? 'game' : 'lobby';
  }

  member(id: PlayerId): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  isConnected(id: PlayerId): boolean {
    const m = this.member(id);
    return !!m && (!!m.bot || m.sockets.size > 0);
  }

  get bots(): Member[] {
    return this.members.filter((m) => m.bot);
  }

  private uniqueName(name: string): string {
    let candidate = name;
    let n = 2;
    while (this.members.some((m) => m.name.toLowerCase() === candidate.toLowerCase())) candidate = `${name.slice(0, 13)} ${n++}`;
    return candidate;
  }

  addMember(name: string): Member {
    const m: Member = {
      id: 'p' + randomBytes(4).toString('hex'),
      name: this.uniqueName(name),
      token: randomBytes(16).toString('hex'),
      sockets: new Set(),
      lastSeen: Date.now(),
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.syncAgencies();
    return m;
  }

  removeMember(id: PlayerId): void {
    this.members = this.members.filter((m) => m.id !== id);
    if (this.hostId === id) this.hostId = this.members.find((m) => !m.bot)?.id ?? '';
    if (!this.bots.length) this.settings = { ...this.settings, testRole: 'random' };
    this.syncAgencies();
  }

  addBot(by: PlayerId): Ack {
    if (by !== this.hostId) return err('Only the host can add bots.');
    if (this.game) return err('Bots can only join in the lobby.');
    if (this.members.length >= MAX_PLAYERS) return err(`The room is full (${MAX_PLAYERS} players).`);
    const used = new Set(this.members.map((m) => m.name));
    const name = BOT_NAMES.map((n) => `Bot ${n}`).find((n) => !used.has(n)) ?? 'Bot';
    const m = this.addMember(name);
    m.bot = { rng: new Rng(), mem: newBotMemory(), phaseKey: '', nextAt: 0 };
    return ok();
  }

  /** Simple mode always deals the easy agencies; Advanced follows the player count until the host picks. */
  private syncAgencies(): void {
    if (this.game) return;
    const simple = this.settings.mode === 'simple';
    if (simple || !this.agenciesTouched) this.settings = { ...this.settings, agencies: suggestedAgencies(this.members.length, this.settings.mode) };
  }

  // ───────── lobby (host only) ─────────

  updateSettings(by: PlayerId, patch: unknown): Ack {
    if (by !== this.hostId) return err('Only the host can change settings.');
    if (this.game) return err('Settings are locked once the game starts.');
    const p = (patch ?? {}) as Record<string, unknown>;
    const before = this.settings.mode;
    if (Array.isArray(p.agencies)) {
      if (this.settings.mode === 'simple' && p.mode !== 'advanced') return err('Switch to Advanced to choose agencies.');
      this.agenciesTouched = true;
    }
    this.settings = sanitizeSettings(this.settings, patch);
    if (this.settings.mode !== before) this.agenciesTouched = false;
    this.syncAgencies();
    return ok();
  }

  applyPreset(by: PlayerId, presetId: unknown): Ack {
    if (by !== this.hostId) return err('Only the host can change settings.');
    if (this.game) return err('Settings are locked once the game starts.');
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return err('Unknown preset.');
    const wasSimple = this.settings.mode === 'simple';
    this.settings = sanitizeSettings(this.settings, preset.patch(this.settings, this.members.length));
    if (wasSimple) this.agenciesTouched = false;
    this.syncAgencies();
    return ok();
  }

  kick(by: PlayerId, target: PlayerId): Ack<string[]> {
    if (by !== this.hostId) return err('Only the host can remove players.');
    if (this.game) return err('Players can only be removed in the lobby.');
    if (target === by) return err("You can't remove yourself.");
    const m = this.member(target);
    if (!m) return err('No such player.');
    this.removeMember(target);
    return ok([...m.sockets]);
  }

  start(by: PlayerId): Ack {
    if (by !== this.hostId) return err('Only the host can start the game.');
    if (this.game) return err('The game has already started.');
    if (this.members.length > MAX_PLAYERS) return err(`At most ${MAX_PLAYERS} players.`);
    const check = checkSettings(this.settings, this.members.length);
    if (check.errors.length) return err(check.errors[0]);
    const testing = this.bots.length > 0 && this.settings.testRole !== 'random';
    this.game = new Game(
      this.members.map((m) => ({ id: m.id, name: m.name })),
      this.settings,
      {
        timerScale: this.timerScale,
        forceMantri: testing && this.settings.testRole === 'mantri' ? [this.hostId] : undefined,
        avoidMantri: testing && this.settings.testRole === 'agency' ? [this.hostId] : undefined,
      },
    );
    for (const b of this.bots) b.bot = { rng: new Rng(), mem: newBotMemory(), phaseKey: '', nextAt: 0 };
    this.claims = [];
    return ok();
  }

  backToLobby(by: PlayerId): Ack {
    if (by !== this.hostId) return err('Only the host can do that.');
    if (!this.game) return err('Already in the lobby.');
    this.game = null;
    this.claims = [];
    // Seats that never came back are dropped so the lobby reflects who is here.
    this.members = this.members.filter((m) => m.bot || m.sockets.size > 0 || m.id === this.hostId);
    this.syncAgencies();
    return ok();
  }

  advance(by: PlayerId): Ack {
    if (by !== this.hostId) return err('Only the host can skip a step.');
    if (!this.game) return err('No game running.');
    if (this.game.paused) return err('Resume the game first.');
    return this.game.forceAdvance() ? ok() : err('Nothing to skip.');
  }

  pause(by: PlayerId, paused: boolean): Ack {
    if (by !== this.hostId) return err('Only the host can pause.');
    if (!this.game) return err('No game running.');
    if (paused) this.game.pause();
    else this.game.resume();
    return ok();
  }

  act(by: PlayerId, action: GameAction): Ack {
    if (!this.game) return err('The game has not started.');
    const res = this.game.act(by, action);
    return res.ok ? ok() : err(res.error);
  }

  // ───────── seat hand-over ─────────

  /** Seats a newcomer may take over mid-game: dropped players and bots. */
  openSeats(): { id: PlayerId; name: string }[] {
    if (!this.game) return [];
    return this.members.filter((m) => m.sockets.size === 0).map((m) => ({ id: m.id, name: m.name }));
  }

  requestClaim(name: string, seat: PlayerId, socketId: string): Ack<string> {
    if (!this.game) return err('The game has not started; just join the lobby.');
    const m = this.member(seat);
    if (!m) return err('No such seat.');
    if (m.sockets.size > 0) return err('That seat is still connected.');
    const id = randomBytes(4).toString('hex');
    this.claims = this.claims.filter((c) => c.socketId !== socketId);
    this.claims.push({ id, name: cleanName(name) || 'Guest', seat, socketId });
    return ok(id);
  }

  resolveClaim(by: PlayerId, claimId: unknown, approve: boolean): Ack<{ socketId: string; token?: string; seat: PlayerId }> {
    if (by !== this.hostId) return err('Only the host can hand over seats.');
    const c = this.claims.find((x) => x.id === claimId);
    if (!c) return err('That request has expired.');
    this.claims = this.claims.filter((x) => x.id !== claimId);
    if (!approve) return ok({ socketId: c.socketId, seat: c.seat });
    const m = this.member(c.seat);
    if (!m) return err('That seat no longer exists.');
    m.token = randomBytes(16).toString('hex');
    m.bot = undefined; // a person now plays this seat
    return ok({ socketId: c.socketId, token: m.token, seat: m.id });
  }

  // ───────── housekeeping ─────────

  private meta() {
    return {
      connected: Object.fromEntries(this.members.map((m) => [m.id, this.isConnected(m.id)])),
      hostId: this.hostId,
      bots: this.bots.map((m) => m.id),
    };
  }

  /** Let each bot act when its "thinking time" for the current phase is up. */
  private runBots(now: number): boolean {
    const g = this.game;
    if (!g || g.paused || g.phase === 'report') return false;
    let changed = false;
    const meta = this.meta();
    for (const m of this.bots) {
      const b = m.bot!;
      const key = `${g.round}:${g.phase}`;
      const [lo, hi] = BOT_DELAY[g.phase] ?? [2, 4];
      const scale = Math.min(1, this.timerScale);
      if (b.phaseKey !== key) {
        b.phaseKey = key;
        b.nextAt = now + (lo + b.rng.next() * (hi - lo)) * 1000 * scale;
        continue;
      }
      if (now < b.nextAt) continue;
      b.nextAt = now + (1.5 + b.rng.next() * 1.5) * 1000 * scale;
      for (const a of houseBotActions(g.viewFor(m.id, meta), b.rng, b.mem)) {
        if (g.act(m.id, a).ok) changed = true;
      }
    }
    if (changed) g.tick();
    return changed;
  }

  /** Called a few times a second. Returns true if views should be re-sent. */
  tick(now = Date.now()): boolean {
    let changed = false;
    if (this.game && this.game.tick()) changed = true;
    if (this.runBots(now)) changed = true;
    // Hand the host role to someone present if the host has been gone a while.
    const host = this.member(this.hostId);
    if (host && host.sockets.size === 0) {
      this.hostAwaySince ??= now;
      if (now - this.hostAwaySince > HOST_HANDOVER_MS) {
        const next = this.members.find((m) => !m.bot && m.sockets.size > 0);
        if (next) {
          this.hostId = next.id;
          this.hostAwaySince = null;
          changed = true;
        }
      }
    } else this.hostAwaySince = null;
    return changed;
  }

  isStale(now = Date.now()): boolean {
    return this.members.every((m) => m.bot || m.sockets.size === 0) && now - this.lastActive > ROOM_IDLE_MS;
  }

  viewFor(pid: PlayerId): RoomView {
    const meta = this.meta();
    return {
      code: this.code,
      me: pid,
      hostId: this.hostId,
      stage: this.stage,
      players: this.members.map((m) => ({ id: m.id, name: m.name, connected: this.isConnected(m.id), isHost: m.id === this.hostId, bot: !!m.bot })),
      settings: this.settings,
      check: checkSettings(this.settings, this.members.length),
      balance: balanceEstimate(this.settings),
      game: this.game ? this.game.viewFor(pid, meta) : null,
      claims: pid === this.hostId ? this.claims.map(({ id, name, seat }) => ({ id, name, seat })) : [],
    };
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(private readonly timerScale = 1) {}

  create(): Room {
    if (this.rooms.size >= 1000) throw new Error('Too many rooms right now.');
    let code = '';
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.timerScale);
    this.rooms.set(code, room);
    return room;
  }

  get(code: unknown): Room | undefined {
    return typeof code === 'string' ? this.rooms.get(code.trim().toUpperCase()) : undefined;
  }

  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) if (room.isStale(now)) this.rooms.delete(code);
  }
}
