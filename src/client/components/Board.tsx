import { useMemo } from 'react';
import { BORDER_BENDS, BORDER_PAIRS, REGIONS, REGION_CODES, type RegionCode, type Zone } from '../../shared/regions';

export const ZONE_COLOURS: Record<Zone, string> = {
  North: '#4dabf7',
  Central: '#ff922b',
  East: '#38d9a9',
  West: '#9775fa',
  South: '#f783ac',
  Northeast: '#69db7c',
};

export type Mark = 'x' | 'q' | 'star';

const R = 21;
const VIEWBOX = '26 56 716 756';

export interface BoardJeep {
  id: string;
  colour: string;
  jeep: RegionCode | null;
}

export interface BoardProps {
  gates: { code: RegionCode; sealed: boolean }[];
  jeeps: BoardJeep[];
  selected: RegionCode | null;
  onSelect: (c: RegionCode) => void;
  /** Regions to light up (deploy options, Mantri's reachable regions, warrant targets…). Others dim. */
  highlight?: RegionCode[] | null;
  marks?: Partial<Record<RegionCode, Mark>>;
  /** Shown only to Mantri ji / Bought agencies (when revealed) and in the report replay. */
  fugitive?: RegionCode | null;
  /** A path to draw, e.g. Mantri ji's planned night route or the replay route. */
  route?: RegionCode[];
  routeTone?: 'plan' | 'past';
  flood?: RegionCode;
  mcc?: RegionCode;
  zoomed?: boolean;
  focusJeep?: string | null;
  /** Fit inside the parent's box (main map). Off = natural height (report). */
  fit?: boolean;
}

function trim(a: [number, number], b: [number, number], r: number): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1;
  return [a[0] + (dx / d) * r, a[1] + (dy / d) * r];
}

/** BORDER_PAIRS are sorted (a < b) and bend points are listed from a to b. */
function borderPath(a: RegionCode, b: RegionCode): string {
  const pts: [number, number][] = [REGIONS[a].pos, ...(BORDER_BENDS[`${a}-${b}`] ?? []), REGIONS[b].pos];
  const first = trim(pts[0], pts[1], R + 1);
  const last = trim(pts[pts.length - 1], pts[pts.length - 2], R + 1);
  const mid = pts.slice(1, -1);
  return [first, ...mid, last].map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
}

const BORDERS = BORDER_PAIRS.map(([a, b]) => ({ key: `${a}-${b}`, d: borderPath(a, b) }));

export function Board(props: BoardProps) {
  const { gates, jeeps, selected, onSelect, highlight, marks = {}, fugitive, route, routeTone = 'plan', flood, mcc, zoomed, focusJeep, fit = true } = props;
  const hl = useMemo(() => (highlight ? new Set(highlight) : null), [highlight]);
  const gateMap = useMemo(() => new Map(gates.map((g) => [g.code, g.sealed])), [gates]);

  // Jeeps sitting in each region, spread around the node.
  const byRegion = useMemo(() => {
    const m = new Map<RegionCode, BoardJeep[]>();
    for (const j of jeeps) if (j.jeep) m.set(j.jeep, [...(m.get(j.jeep) ?? []), j]);
    return m;
  }, [jeeps]);

  const routeSegments = useMemo(() => {
    if (!route || route.length < 2) return [];
    const segs: { d: string; key: string }[] = [];
    for (let i = 1; i < route.length; i++) {
      const a = REGIONS[route[i - 1]].pos;
      const b = REGIONS[route[i]].pos;
      if (route[i - 1] === route[i]) continue;
      const p1 = trim(a, b, R + 3);
      const p2 = trim(b, a, R + 6);
      segs.push({ key: `${i}`, d: `M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}` });
    }
    return segs;
  }, [route]);

  return (
    <svg
      className="board"
      viewBox={VIEWBOX}
      style={zoomed ? { width: '190%', height: 'auto' } : fit ? { width: '100%', height: '100%' } : { width: '100%', height: 'auto' }}
      role="img"
      aria-label="Map of India's 31 regions"
    >
      <defs>
        <marker id="arrow-plan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ff5c5c" />
        </marker>
        <marker id="arrow-past" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ffd43b" />
        </marker>
      </defs>

      <g className="borders">
        {BORDERS.map((b) => (
          <path key={b.key} d={b.d} />
        ))}
      </g>

      {REGION_CODES.map((c) => {
        const r = REGIONS[c];
        const [x, y] = r.pos;
        const col = ZONE_COLOURS[r.zone];
        const dim = hl && !hl.has(c);
        const mark = marks[c];
        const isGate = gateMap.has(c);
        const sealed = gateMap.get(c) === true;
        return (
          <g key={c} className={dim ? 'node dim' : 'node'} transform={`translate(${x} ${y})`}>
            {isGate && <circle r={R + 6} className={sealed ? 'gate sealed' : 'gate'} />}
            {hl?.has(c) && <circle r={R + 3} className="hl" />}
            <circle r={R} fill={col} fillOpacity={mark === 'x' ? 0.06 : 0.22} stroke={col} strokeWidth={1.6} />
            {c === flood && <circle r={R} className="flood" />}
            {c === mcc && <circle r={R + 3} className="mcc" />}
            <text className="rcode" y={5.5} textAnchor="middle">
              {c}
            </text>
            {mark === 'x' && <path className="cross" d={`M${-R + 5} ${-R + 5}L${R - 5} ${R - 5}M${R - 5} ${-R + 5}L${-R + 5} ${R - 5}`} />}
            {mark === 'q' && (
              <g transform={`translate(${R - 2} ${-R + 2})`}>
                <circle r={9} className="badge q" />
                <text y={4.5} textAnchor="middle" className="badge-t">?</text>
              </g>
            )}
            {mark === 'star' && (
              <g transform={`translate(${R - 2} ${-R + 2})`}>
                <circle r={9} className="badge star" />
                <text y={4.5} textAnchor="middle" className="badge-t">★</text>
              </g>
            )}
            {sealed && (
              <text className="lock" x={-R - 4} y={-R + 4} textAnchor="middle">🔒</text>
            )}
            {c === flood && <text className="icon" y={-R - 4} textAnchor="middle">🌊</text>}
            {c === mcc && <text className="icon" y={-R - 4} textAnchor="middle">🗳</text>}
            {selected === c && <circle r={R + 9} className="sel" />}
          </g>
        );
      })}

      {routeSegments.length > 0 && (
        <g className={routeTone === 'plan' ? 'route plan' : 'route past'}>
          {routeSegments.map((s) => (
            <path key={s.key} d={s.d} markerEnd={`url(#arrow-${routeTone})`} />
          ))}
        </g>
      )}

      {[...byRegion.entries()].map(([c, list]) => {
        const [x, y] = REGIONS[c].pos;
        return list.map((j, i) => {
          const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(list.length, 6) + (list.length > 6 ? 0 : 0.6);
          const jx = x + Math.cos(ang) * (R + 9);
          const jy = y + Math.sin(ang) * (R + 9);
          return (
            <circle
              key={j.id}
              cx={jx}
              cy={jy}
              r={focusJeep === j.id ? 11 : 8.5}
              fill={j.colour}
              className={focusJeep === j.id ? 'jeep focus' : 'jeep'}
            />
          );
        });
      })}

      {fugitive && (
        <g className="fugitive" transform={`translate(${REGIONS[fugitive].pos[0]} ${REGIONS[fugitive].pos[1]})`}>
          <circle r={R + 12} className="pulse" />
          <circle r={R + 4} className="ring" />
          <text y={-R - 9} textAnchor="middle" className="ftag">₹ B</text>
        </g>
      )}

      <g className="hits">
        {REGION_CODES.map((c) => (
          <circle
            key={c}
            cx={REGIONS[c].pos[0]}
            cy={REGIONS[c].pos[1]}
            r={R + 4}
            onClick={() => onSelect(c)}
            aria-label={REGIONS[c].name}
          />
        ))}
      </g>
    </svg>
  );
}
