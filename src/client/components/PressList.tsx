import { describeClaim, describeClue } from '../../shared/describe';
import { REGIONS } from '../../shared/regions';
import type { GameView, PressRow, StingResult } from '../../shared/types';
import { cls, colourOf, labelOf } from '../util';

export function PressList(props: { g: GameView; rows: PressRow[]; onSting?: (id: string) => void; highlight?: string | null }) {
  const { g, rows } = props;
  if (!rows.length) return <p className="muted small">No Press Releases yet.</p>;
  return (
    <ul className="press">
      {rows.map((r) => (
        <li key={r.player} className={cls(props.highlight === r.player && 'hl')}>
          <span className="dot" style={{ background: colourOf(g, r.player) }} />
          <div className="grow">
            <div className="row between">
              <strong>{labelOf(g, r.player)}</strong>
              {r.from && <span className="muted small">from {REGIONS[r.from].name}</span>}
            </div>
            <div className={cls('claim', r.claim.none && 'muted')}>{describeClaim(r.claim, (id) => labelOf(g, id))}</div>
          </div>
          {props.onSting && (
            <button type="button" className="btn small danger" onClick={() => props.onSting!(r.player)}>
              🎥 Sting
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function StingCard({ g, s }: { g: GameView; s: StingResult }) {
  return (
    <div className={cls('sting', s.verdict === 'MISMATCH' ? 'bad' : s.verdict === 'MATCH' ? 'good' : 'meh')}>
      <div className="row between">
        <strong>🎥 Sting on {labelOf(g, s.target)}</strong>
        <span className="verdict">{s.verdict}</span>
      </div>
      <div className="small">
        Received: <em>{describeClue(s.received, (id) => labelOf(g, id))}</em>
        {s.hot ? ' · 🔥 Hot Trail' : ''}
      </div>
      <div className="small">
        Posted: <em>{describeClaim(s.claim, (id) => labelOf(g, id))}</em>
      </div>
      <div className="small muted">A Sting proves honesty, not truth: a Planted Leak still shows MATCH.</div>
    </div>
  );
}
