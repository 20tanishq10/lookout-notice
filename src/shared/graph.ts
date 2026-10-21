import { REGIONS, REGION_CODES, type RegionCode } from './regions';

export const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Dir = (typeof DIRS)[number];

function bfs(start: RegionCode): Record<RegionCode, number> {
  const d = { [start]: 0 } as Record<RegionCode, number>;
  const q: RegionCode[] = [start];
  while (q.length) {
    const u = q.shift()!;
    for (const w of REGIONS[u].borders) {
      if (d[w] === undefined) {
        d[w] = d[u] + 1;
        q.push(w);
      }
    }
  }
  return d;
}

/** All-pairs border distances (fewest border crossings). */
export const DIST: Record<RegionCode, Record<RegionCode, number>> = Object.fromEntries(
  REGION_CODES.map((c) => [c, bfs(c)]),
) as Record<RegionCode, Record<RegionCode, number>>;

export function dist(a: RegionCode, b: RegionCode): number {
  return DIST[a][b];
}

export function areNeighbours(a: RegionCode, b: RegionCode): boolean {
  return REGIONS[a].borders.includes(b);
}

/** Compass direction from region `from` to region `to`, using reference points, in eight 45° sectors. */
export function bearing(from: RegionCode, to: RegionCode): Dir | 'Here' {
  if (from === to) return 'Here';
  const [lat1, lon1] = REGIONS[from].ref;
  const [lat2, lon2] = REGIONS[to].ref;
  const meanLat = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const dx = (lon2 - lon1) * Math.cos(meanLat);
  const dy = lat2 - lat1;
  let ang = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (ang < 0) ang += 360;
  return DIRS[Math.round(ang / 45) % 8];
}

/**
 * Regions reachable from `from` in at most `maxSteps` border crossings without entering a blocked region.
 * If `from` itself is locked (e.g. flooded), only `from` is returned. Always includes `from`.
 */
export function reachable(
  from: RegionCode,
  maxSteps: number,
  cannotEnter: (c: RegionCode) => boolean,
  cannotLeaveFrom = false,
): RegionCode[] {
  if (cannotLeaveFrom || maxSteps <= 0) return [from];
  const seen = new Map<RegionCode, number>([[from, 0]]);
  const q: RegionCode[] = [from];
  while (q.length) {
    const u = q.shift()!;
    const du = seen.get(u)!;
    if (du >= maxSteps) continue;
    for (const w of REGIONS[u].borders) {
      if (seen.has(w) || cannotEnter(w)) continue;
      seen.set(w, du + 1);
      q.push(w);
    }
  }
  return [...seen.keys()];
}
