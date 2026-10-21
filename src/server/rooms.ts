import { randomBytes } from 'node:crypto';
import { Game } from '../engine/game';
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
}

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
    return (this.member(id)?.sockets.size ?? 0) > 0;
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
    if (this.hostId === id) this.hostId = this.members[0]?.id ?? '';
    this.syncAgencies();
  }

  private syncAgencies(): void {
    if (!this.agenciesTouched && !this.game) this.settings = { ...this.settings, agencies: suggestedAgencies(this.members.length) };
  }

  // ───────── lobby (host only) ─────────

  updateSettings(by: PlayerId, patch: unknown): Ack {
    if (by !== this.hostId) return err('Only the host can change settings.');
    if (this.game) return err('Settings are locked once the game starts.');
    const p = (patch ?? {}) as Record<string, unknown>;
    if (Array.isArray(p.agencies)) this.agenciesTouched = true;
    this.settings = sanitizeSettings(this.settings, patch);
    return ok();
  }

  applyPreset(by: PlayerId, presetId: unknown): Ack {
    if (by !== this.hostId) return err('Only the host can change settings.');
    if (this.game) return err('Settings are locked once the game starts.');
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return err('Unknown preset.');
    this.settings = sanitizeSettings(this.settings, preset.patch(this.settings, this.members.length));
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
    this.game = new Game(
      this.members.map((m) => ({ id: m.id, name: m.name })),
      this.settings,
      { timerScale: this.timerScale },
    );
    this.claims = [];
    return ok();
  }

  backToLobby(by: PlayerId): Ack {
    if (by !== this.hostId) return err('Only the host can do that.');
    if (!this.game) return err('Already in the lobby.');
    this.game = null;
    this.claims = [];
    // Seats that never came back are dropped so the lobby reflects who is here.
    this.members = this.members.filter((m) => m.sockets.size > 0 || m.id === this.hostId);
    this.syncAgencies();
    return ok();
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
    return ok({ socketId: c.socketId, token: m.token, seat: m.id });
  }

  // ───────── housekeeping ─────────

  /** Called a few times a second. Returns true if views should be re-sent. */
  tick(now = Date.now()): boolean {
    let changed = false;
    if (this.game && this.game.tick()) changed = true;
    // Hand the host role to someone present if the host has been gone a while.
    const host = this.member(this.hostId);
    if (host && host.sockets.size === 0) {
      this.hostAwaySince ??= now;
      if (now - this.hostAwaySince > HOST_HANDOVER_MS) {
        const next = this.members.find((m) => m.sockets.size > 0);
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
    return this.members.every((m) => m.sockets.size === 0) && now - this.lastActive > ROOM_IDLE_MS;
  }

  viewFor(pid: PlayerId): RoomView {
    const connected = Object.fromEntries(this.members.map((m) => [m.id, m.sockets.size > 0]));
    return {
      code: this.code,
      me: pid,
      hostId: this.hostId,
      stage: this.stage,
      players: this.members.map((m) => ({ id: m.id, name: m.name, connected: m.sockets.size > 0, isHost: m.id === this.hostId })),
      settings: this.settings,
      check: checkSettings(this.settings, this.members.length),
      balance: balanceEstimate(this.settings),
      game: this.game ? this.game.viewFor(pid, { connected, hostId: this.hostId }) : null,
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
