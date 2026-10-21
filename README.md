# Lookout Notice

A 5–8 player hidden-traitor deduction game set across India. Rival agencies hunt the fugitive Seth Bhagodalal while one player, secretly Mantri ji, tries to fly him out. About 18 minutes a game. Built to be played on phones over a call or in the same room.

Rules: see the rulebook doc ("Lookout Notice — Rulebook").

## Run it locally

Needs Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Friends on the same Wi-Fi can join from their phones using the **Network** URL that Vite prints (for example `http://192.168.1.12:5173`).

## Play with friends over the internet

**Quickest (no deploy):** run the production build on your laptop and open a temporary public tunnel.

```bash
npm run build
npm start                      # serves everything on http://localhost:3001
brew install cloudflared       # once
cloudflared tunnel --url http://localhost:3001
```

Share the `https://….trycloudflare.com` link it prints. It works as long as your laptop stays on.

**Permanent link (free):** deploy to [Render](https://render.com) from GitHub.

1. Sign in to Render with GitHub and allow access to this repo.
2. **New → Blueprint**, pick the repo and the `main` branch, then **Deploy Blueprint**. `render.yaml` sets everything up.
3. Share the `https://lookout-notice-xxxx.onrender.com` URL.

Every push to `main` redeploys automatically. The free plan sleeps after 15 minutes with no traffic (game messages count as traffic), and the first visit after that takes about a minute to wake. Rooms live in memory, so a redeploy or restart ends any game in progress.

Netlify and Vercel only host static sites and short-lived functions, so they can't run the game server.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (port 3001) + Vite client (port 5173) with hot reload |
| `npm run build` | Builds the client into `dist/client` and the server into `dist/server.js` |
| `npm start` | Runs the built game on `PORT` (default 3001) |
| `npm test` | Rules tests, 300 random bot games, and full games over real sockets |
| `npm run typecheck` | TypeScript check |

`TIMER_SCALE=0.2 npm run dev:server` speeds every phase up, which is handy for testing alone.

## How the code is laid out

```
src/shared/   board data (31 regions, borders, Gazetteer), agencies, settings, types
src/engine/   the rules: game.ts (state machine, views), clues.ts, bot.ts (test bot)
src/server/   Express + Socket.io: rooms, lobby, timers, reconnects, seat hand-over
src/client/   React app: lobby, map, phase panels, feed, chat, Commission Report
tests/        engine.test.ts, server.test.ts
```

The server is the only source of truth. Each player gets a view built for them (`Game.viewFor`), so secrets such as where Bhagodalal is never reach other players' browsers.

## Rule notes

- In Hidden agencies mode, Mantri ji can still see every player's agency, so Planted Leaks keep working.
- Exit gates: 5 drops Manipur, 6 is the default set, and 7 adds Chennai.
