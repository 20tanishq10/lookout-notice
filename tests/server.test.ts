import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botActions } from '../src/engine/bot';
import { createGameServer } from '../src/server/app';
import { Rng } from '../src/shared/rng';
import { PRESETS } from '../src/shared/settings';
import type { RoomView } from '../src/shared/types';

let srv: ReturnType<typeof createGameServer>;
let url = '';

beforeAll(async () => {
  srv = createGameServer({ timerScale: 0.02 });
  await new Promise<void>((r) => srv.http.listen(0, r));
  url = `http://localhost:${(srv.http.address() as AddressInfo).port}`;
});
afterAll(() => srv.stop());

function client(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connectClient(url, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function emit<T = any>(s: Socket, ev: string, payload?: unknown): Promise<{ ok: boolean; error?: string; data?: T }> {
  return new Promise((resolve) => s.emit(ev, payload ?? {}, resolve));
}

interface Bot {
  socket: Socket;
  token: string;
  playerId: string;
  latest: RoomView | null;
  rng: Rng;
  timer: NodeJS.Timeout | null;
  errors: string[];
}

function drive(bot: Bot) {
  bot.socket.on('view', (v: RoomView) => {
    bot.latest = v;
    if (bot.timer) return;
    bot.timer = setTimeout(async () => {
      bot.timer = null;
      const g = bot.latest?.game;
      if (!g) return;
      for (const a of botActions(g, bot.rng)) {
        const res = await emit(bot.socket, 'game:act', a);
        if (!res.ok && /went wrong/.test(res.error ?? '')) bot.errors.push(res.error!);
      }
    }, 30 + bot.rng.int(120));
  });
}

async function playOne(n: number, seed: number, preset: string) {
  const rng = new Rng(seed);
  const host = await client();
  const created = await emit<{ code: string; token: string; playerId: string }>(host, 'room:create', { name: 'Host' });
  expect(created.ok).toBe(true);
  const { code } = created.data!;
  const bots: Bot[] = [{ socket: host, token: created.data!.token, playerId: created.data!.playerId, latest: null, rng: new Rng(seed + 1), timer: null, errors: [] }];
  for (let i = 1; i < n; i++) {
    const s = await client();
    const joined = await emit<{ token: string; playerId: string }>(s, 'room:join', { code, name: `Bot ${i}` });
    expect(joined.ok).toBe(true);
    bots.push({ socket: s, token: joined.data!.token, playerId: joined.data!.playerId, latest: null, rng: new Rng(seed + 10 + i), timer: null, errors: [] });
  }
  expect((await emit(host, 'lobby:preset', { id: preset })).ok).toBe(true);
  if (preset === 'paranoia' && n < 7) expect((await emit(host, 'lobby:settings', { mantris: 1 })).ok).toBe(true);
  const started = await emit(host, 'game:start');
  expect(started).toEqual({ ok: true });
  bots.forEach(drive);

  // Drop one bot mid-game and bring it back with its token.
  const flaky = bots[n - 1];
  await new Promise((r) => setTimeout(r, 1500 + rng.int(1500)));
  flaky.socket.disconnect();
  await new Promise((r) => setTimeout(r, 400));
  const again = await client();
  const rejoined = await emit(again, 'room:rejoin', { code, token: flaky.token });
  expect(rejoined.ok).toBe(true);
  flaky.socket = again;
  drive(flaky);

  const done = await new Promise<boolean>((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (bots.every((b) => b.latest?.game?.phase === 'report')) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - t0 > 90_000) {
        clearInterval(iv);
        resolve(false);
      }
    }, 100);
  });
  expect(done).toBe(true);
  for (const b of bots) expect(b.errors).toEqual([]);
  const report = bots[0].latest!.game!.report!;
  expect(report.scores.length).toBe(n);

  // Host takes everyone back to the lobby for a rematch.
  expect((await emit(host, 'host:lobby')).ok).toBe(true);
  for (const b of bots) b.socket.disconnect();
  return report.outcome.type;
}

describe('server', () => {
  it('runs full games for 5–8 bots over real sockets, with a reconnect', async () => {
    const presets = PRESETS.map((p) => p.id);
    const results = await Promise.all([
      playOne(5, 11, presets[0]),
      playOne(6, 22, presets[1]),
      playOne(7, 33, presets[2]),
      playOne(8, 44, presets[3]),
    ]);
    console.log('socket game outcomes', results);
  }, 120_000);

  it('rejects bad input without crashing', async () => {
    const s = await client();
    expect((await emit(s, 'room:join', { code: 'ZZZZ', name: 'x' })).ok).toBe(false);
    expect((await emit(s, 'room:create', { name: '   ' })).ok).toBe(false);
    expect((await emit(s, 'game:act', { type: 'deploy', region: 'XX' })).ok).toBe(false);
    const created = await emit<{ code: string }>(s, 'room:create', { name: 'Solo' });
    expect(created.ok).toBe(true);
    const start = await emit(s, 'game:start');
    expect(start.ok).toBe(false);
    expect((await emit(s, 'lobby:settings', { rounds: 99, agencies: ['CBI', 'NOPE'] })).ok).toBe(true);
    s.disconnect();
  });
});
