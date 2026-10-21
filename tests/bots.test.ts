import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botActions } from '../src/engine/bot';
import { Game } from '../src/engine/game';
import { houseBotActions, newBotMemory } from '../src/engine/houseBot';
import { createGameServer } from '../src/server/app';
import { AGENCY_IDS, type AgencyId } from '../src/shared/agencies';
import { Rng } from '../src/shared/rng';
import { defaultSettings, type Settings } from '../src/shared/settings';
import type { RoomView } from '../src/shared/types';

function houseGame(n: number, seed: number, patch: Partial<Settings> = {}) {
  let t = 5_000_000;
  const now = () => t;
  const players = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` }));
  const game = new Game(players, { ...defaultSettings(n), ...patch }, { seed, now });
  const meta = { connected: Object.fromEntries(players.map((p) => [p.id, true])), hostId: 'b0', bots: players.map((p) => p.id) };
  const rngs = players.map((_, i) => new Rng(seed * 31 + i));
  const mems = players.map(() => newBotMemory());
  let guard = 0;
  while (game.phase !== 'report') {
    if (guard++ > 4000) throw new Error(`seed ${seed} stuck in ${game.phase}`);
    players.forEach((p, i) => {
      for (const a of houseBotActions(game.viewFor(p.id, meta), rngs[i], mems[i])) game.act(p.id, a);
    });
    t += 1500;
    game.tick();
  }
  return game;
}

describe('house bots', () => {
  it('honours the test-role options when dealing Mantri ji', () => {
    const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    for (let seed = 1; seed <= 30; seed++) {
      const forced = new Game(players, defaultSettings(5), { seed, forceMantri: ['p0'] });
      expect(forced.debugState().mantris).toEqual(['p0']);
      const avoided = new Game(players, defaultSettings(5), { seed, avoidMantri: ['p0'] });
      expect(avoided.debugState().mantris).not.toContain('p0');
    }
  });

  it('play whole games on their own, with every outcome possible', () => {
    const outcomes: Record<string, number> = { arrest: 0, escape: 0, survived: 0 };
    let mantriWins = 0;
    const N = 200;
    for (let seed = 1; seed <= N; seed++) {
      const rng = new Rng(seed);
      const n = 5 + rng.int(4);
      const game = houseGame(n, seed, {
        agencies: rng.shuffle(AGENCY_IDS).slice(0, n) as AgencyId[],
        hiddenAgencies: rng.next() < 0.2,
        mantris: n >= 7 && rng.next() < 0.3 ? 2 : 1,
      });
      const o = game.outcome!.type;
      outcomes[o]++;
      if (o !== 'arrest') mantriWins++;
    }
    console.log('house-bot outcomes', outcomes, `Mantri ji won ${Math.round((100 * mantriWins) / N)}%`);
    expect(outcomes.arrest).toBeGreaterThan(0);
    expect(outcomes.escape + outcomes.survived).toBeGreaterThan(0);
  });
});

describe('bots in a real room', () => {
  let srv: ReturnType<typeof createGameServer>;
  let url = '';
  beforeAll(async () => {
    srv = createGameServer({ timerScale: 0.03 });
    await new Promise<void>((r) => srv.http.listen(0, r));
    url = `http://localhost:${(srv.http.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.stop());

  const client = () =>
    new Promise<Socket>((resolve, reject) => {
      const s = connectClient(url, { transports: ['websocket'], forceNew: true });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  const emit = (s: Socket, ev: string, payload?: unknown) =>
    new Promise<{ ok: boolean; error?: string; data?: any }>((resolve) => s.emit(ev, payload ?? {}, resolve));

  it('lets one person play a full game against 4 bots, as Mantri ji or as an agency', async () => {
    for (const testRole of ['mantri', 'agency'] as const) {
      const me = await client();
      let latest: RoomView | null = null;
      me.on('view', (v: RoomView) => (latest = v));
      const created = await emit(me, 'room:create', { name: 'Tanishq' });
      expect(created.ok).toBe(true);
      for (let i = 0; i < 4; i++) expect((await emit(me, 'lobby:addBot')).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 100));
      expect(latest!.players.filter((p) => p.bot).length).toBe(4);
      expect(latest!.check.errors).toEqual([]);
      expect((await emit(me, 'lobby:settings', { testRole })).ok).toBe(true);
      expect((await emit(me, 'game:start')).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 100));
      expect(latest!.game!.me.role).toBe(testRole === 'mantri' ? 'mantri' : 'agency');

      // Play the human seat with the chaotic test bot until the report.
      const rng = new Rng(testRole === 'mantri' ? 5 : 6);
      const done = await new Promise<boolean>((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(async () => {
          const g = latest?.game;
          if (g?.phase === 'report') {
            clearInterval(iv);
            resolve(true);
            return;
          }
          if (Date.now() - t0 > 60_000) {
            clearInterval(iv);
            resolve(false);
            return;
          }
          if (g) for (const a of botActions(g, rng)) await emit(me, 'game:act', a);
        }, 120);
      });
      expect(done).toBe(true);
      const rep = latest!.game!.report!;
      expect(rep.scores.length).toBe(5);
      // Bots actually took part: they posted Press Releases.
      const botIds = latest!.players.filter((p) => p.bot).map((p) => p.id);
      const botReleases = rep.rounds.flatMap((r) => r.releases).filter((r) => botIds.includes(r.player) && !r.claim.none);
      expect(botReleases.length).toBeGreaterThan(0);
      me.disconnect();
    }
  }, 150_000);
});
