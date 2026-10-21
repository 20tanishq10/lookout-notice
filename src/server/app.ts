import express from 'express';
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { Server, type Socket } from 'socket.io';
import { MAX_PLAYERS } from '../shared/settings';
import type { Ack, GameAction } from '../shared/types';
import { RoomManager, cleanName, type Room } from './rooms';

export interface AppOptions {
  /** Multiplies every phase timer (tests use a small value). */
  timerScale?: number;
  /** Folder with the built client to serve, if any. */
  clientDir?: string;
}

type AckFn = (res: Ack<any>) => void;

/** Builds the HTTP + Socket.io server. Call `.listen(port)` on the result. */
export function createGameServer(opts: AppOptions = {}): { http: HttpServer; io: Server; rooms: RoomManager; stop: () => void } {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { pingInterval: 10_000, pingTimeout: 20_000, maxHttpBufferSize: 64_000 });
  const rooms = new RoomManager(opts.timerScale ?? 1);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });
  if (opts.clientDir && existsSync(opts.clientDir)) {
    app.use(express.static(opts.clientDir, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(opts.clientDir!, 'index.html')));
  }

  /** Socket → where it sits. */
  const seats = new Map<string, { code: string; pid: string }>();

  const broadcast = (room: Room) => {
    room.lastActive = Date.now();
    for (const m of room.members) {
      if (!m.sockets.size) continue;
      const view = room.viewFor(m.id);
      for (const sid of m.sockets) io.to(sid).emit('view', view);
    }
  };

  const attach = (socket: Socket, room: Room, pid: string) => {
    const prev = seats.get(socket.id);
    if (prev) detach(socket);
    const m = room.member(pid)!;
    m.sockets.add(socket.id);
    m.lastSeen = Date.now();
    seats.set(socket.id, { code: room.code, pid });
  };

  const detach = (socket: Socket) => {
    const s = seats.get(socket.id);
    if (!s) return;
    seats.delete(socket.id);
    const room = rooms.get(s.code);
    const m = room?.member(s.pid);
    if (!room || !m) return;
    m.sockets.delete(socket.id);
    m.lastSeen = Date.now();
    // Leaving the lobby for good (closing the tab) frees the spot after a grace period.
    if (!room.game && m.sockets.size === 0) {
      setTimeout(() => {
        const r = rooms.get(s.code);
        const mm = r?.member(s.pid);
        if (r && mm && !r.game && mm.sockets.size === 0) {
          r.removeMember(s.pid);
          if (r.members.every((x) => x.bot)) rooms.rooms.delete(r.code);
          else broadcast(r);
        }
      }, 60_000);
    }
    broadcast(room);
  };

  const ctx = (socket: Socket): { room: Room; pid: string } | null => {
    const s = seats.get(socket.id);
    if (!s) return null;
    const room = rooms.get(s.code);
    if (!room || !room.member(s.pid)) return null;
    return { room, pid: s.pid };
  };

  const safe = (fn: (...args: any[]) => Ack<any> | void) => (...args: any[]) => {
    const ack: AckFn = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      const res = fn(...args);
      if (res) ack(res);
    } catch (e) {
      console.error(e);
      ack({ ok: false, error: 'Something went wrong on the server.' });
    }
  };

  io.on('connection', (socket) => {
    socket.on('room:create', safe((p: { name?: unknown }) => {
      const name = cleanName(p?.name);
      if (!name) return { ok: false, error: 'Enter your name.' };
      const room = rooms.create();
      const m = room.addMember(name);
      attach(socket, room, m.id);
      broadcast(room);
      return { ok: true, data: { code: room.code, token: m.token, playerId: m.id } };
    }));

    socket.on('room:join', safe((p: { code?: unknown; name?: unknown }) => {
      const room = rooms.get(p?.code);
      if (!room) return { ok: false, error: 'No room with that code.' };
      const name = cleanName(p?.name);
      if (!name) return { ok: false, error: 'Enter your name.' };
      if (room.game) return { ok: false, error: 'in-progress', data: { seats: room.openSeats() } };
      if (room.members.length >= MAX_PLAYERS) return { ok: false, error: 'This room is full (8 players).' };
      const m = room.addMember(name);
      attach(socket, room, m.id);
      broadcast(room);
      return { ok: true, data: { code: room.code, token: m.token, playerId: m.id } };
    }));

    socket.on('room:rejoin', safe((p: { code?: unknown; token?: unknown }) => {
      const room = rooms.get(p?.code);
      const m = room?.members.find((x) => x.token === p?.token);
      if (!room || !m) return { ok: false, error: 'That seat is gone.' };
      attach(socket, room, m.id);
      broadcast(room);
      return { ok: true, data: { code: room.code, token: m.token, playerId: m.id } };
    }));

    socket.on('room:leave', safe(() => {
      const c = ctx(socket);
      if (!c) return { ok: true };
      detach(socket);
      if (!c.room.game) {
        c.room.removeMember(c.pid);
        if (c.room.members.every((x) => x.bot)) rooms.rooms.delete(c.room.code);
        else broadcast(c.room);
      }
      return { ok: true };
    }));

    socket.on('room:claim', safe((p: { code?: unknown; name?: unknown; seat?: unknown }) => {
      const room = rooms.get(p?.code);
      if (!room) return { ok: false, error: 'No room with that code.' };
      const res = room.requestClaim(cleanName(p?.name), String(p?.seat ?? ''), socket.id);
      if (res.ok) broadcast(room);
      return res;
    }));

    socket.on('host:claim', safe((p: { claimId?: unknown; approve?: unknown }) => {
      const c = ctx(socket);
      if (!c) return { ok: false, error: 'Not in a room.' };
      const res = c.room.resolveClaim(c.pid, p?.claimId, p?.approve === true);
      if (res.ok && res.data) {
        const { socketId, token, seat } = res.data;
        if (token) {
          // Kick any stale socket on that seat, then let the claimant in.
          const m = c.room.member(seat)!;
          for (const sid of m.sockets) seats.delete(sid);
          m.sockets.clear();
          io.to(socketId).emit('claim:result', { ok: true, data: { code: c.room.code, token, playerId: seat } });
        } else io.to(socketId).emit('claim:result', { ok: false, error: 'The host declined.' });
      }
      broadcast(c.room);
      return res.ok ? { ok: true } : res;
    }));

    const hostAction = (name: string, fn: (room: Room, pid: string, payload: any) => Ack<any>) => {
      socket.on(name, safe((payload: any) => {
        const c = ctx(socket);
        if (!c) return { ok: false, error: 'Not in a room.' };
        const res = fn(c.room, c.pid, payload);
        if (res.ok) broadcast(c.room);
        return res.ok ? { ok: true } : res;
      }));
    };

    hostAction('lobby:settings', (room, pid, patch) => room.updateSettings(pid, patch));
    hostAction('lobby:preset', (room, pid, p) => room.applyPreset(pid, p?.id));
    hostAction('lobby:addBot', (room, pid) => room.addBot(pid));
    hostAction('lobby:kick', (room, pid, p) => {
      const res = room.kick(pid, String(p?.playerId ?? ''));
      if (res.ok) {
        for (const sid of res.data ?? []) {
          seats.delete(sid);
          io.to(sid).emit('kicked');
        }
      }
      return res;
    });
    hostAction('game:start', (room, pid) => room.start(pid));
    hostAction('host:pause', (room, pid, p) => room.pause(pid, p?.paused === true));
    hostAction('host:lobby', (room, pid) => room.backToLobby(pid));

    socket.on('game:act', safe((action: GameAction) => {
      const c = ctx(socket);
      if (!c) return { ok: false, error: 'Not in a room.' };
      const res = c.room.act(c.pid, action);
      if (res.ok) {
        // A finished phase may have advanced the game straight away.
        c.room.tick();
        broadcast(c.room);
      }
      return res;
    }));

    socket.on('disconnect', () => detach(socket));
  });

  const ticker = setInterval(() => {
    for (const room of rooms.rooms.values()) if (room.tick()) broadcast(room);
  }, 200);
  const sweeper = setInterval(() => rooms.sweep(), 10 * 60 * 1000);

  return {
    http,
    io,
    rooms,
    stop: () => {
      clearInterval(ticker);
      clearInterval(sweeper);
      io.close();
      http.close();
    },
  };
}
