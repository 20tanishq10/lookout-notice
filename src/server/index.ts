import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
// In production this file is dist/server.js and the built client sits in dist/client.
const clientDir = path.join(here, 'client');
const port = Number(process.env.PORT ?? 3001);
const timerScale = Number(process.env.TIMER_SCALE ?? 1);

const { http } = createGameServer({ clientDir, timerScale });
http.listen(port, () => {
  console.log(`Lookout Notice server on http://localhost:${port}${timerScale !== 1 ? ` (timers ×${timerScale})` : ''}`);
});
