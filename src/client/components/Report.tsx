import { useMemo, useState } from 'react';
import { AGENCIES } from '../../shared/agencies';
import { describeClaim, describeClue } from '../../shared/describe';
import { REGIONS, type RegionCode } from '../../shared/regions';
import type { GameView, Report as ReportT, RoomView } from '../../shared/types';
import { hostEmit, leaveRoom } from '../net';
import { cls } from '../util';
import { Board } from './Board';

const HOW: Record<string, string> = { move: 'moved', hawala: 'moved silently (Hawala)', tipoff: 'took the tip-off', forced: 'was flushed out' };

export function Report({ room, g }: { room: RoomView; g: GameView }) {
  const rep = g.report as ReportT;
  const [round, setRound] = useState(rep.rounds.length);
  const [open, setOpen] = useState<string | null>(null);
  const role = (id: string) => rep.roles.find((r) => r.id === id)!;
  const name = (id: string) => role(id)?.name ?? '?';
  const label = (id: string) => `${name(id)} · ${AGENCIES[role(id).agency].short}`;
  const rr = rep.rounds[round - 1];

  const path = useMemo(() => {
    const p: RegionCode[] = [rep.start];
    for (const r of rep.rounds.slice(0, round)) for (const s of r.steps) p.push(s.to);
    return p;
  }, [rep, round]);

  const o = rep.outcome;
  const headline =
    o.type === 'arrest'
      ? `🚔 The agencies arrested Bhagodalal in ${REGIONS[o.region].name} in Round ${o.round}.`
      : o.type === 'escape'
        ? `✈ Bhagodalal flew out from ${REGIONS[o.region].gate?.name} on the night of Round ${o.round}.`
        : `⌛ Bhagodalal was still free after Round ${o.round}, hiding in ${REGIONS[o.region].name}.`;
  const winner = rep.scores.filter((s) => s.rank === 1);

  return (
    <div className="report">
      <header className="report-head">
        <div className="kicker">Inquiry Commission Report · Room {room.code}</div>
        <h1>{headline}</h1>
        <p>
          🏆 {winner.map((w) => name(w.id)).join(' & ')} win{winner.length === 1 ? 's' : ''} with {winner[0]?.total} points.
        </p>
      </header>

      <section className="card">
        <h2>Who was who</h2>
        <ul className="roles">
          {rep.roles.map((r) => (
            <li key={r.id}>
              <span className="dot" style={{ background: r.colour }} />
              <b>{r.name}</b> <span className="muted">{AGENCIES[r.agency].name}</span>
              {r.role === 'mantri' && <span className="tag red">🎩 Mantri ji</span>}
              {r.role === 'bought' && <span className="tag gold">💰 Bought</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Scores</h2>
        <ol className="scores">
          {rep.scores.map((s) => (
            <li key={s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
              <div className="row between">
                <span>
                  <span className="rank">#{s.rank}</span> {name(s.id)}
                </span>
                <b>{s.total}</b>
              </div>
              {open === s.id && (
                <ul className="events small">
                  {s.events.length === 0 && <li className="muted">No points</li>}
                  {s.events.map((e, i) => (
                    <li key={i} className="row between">
                      <span>{e.reason}</span>
                      <span className={e.points < 0 ? 'neg' : 'pos'}>{e.points > 0 ? `+${e.points}` : e.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <p className="muted small">Tap a name for the breakdown.</p>
      </section>

      <section className="card">
        <h2>His route</h2>
        <div className="seg wrap">
          {rep.rounds.map((r) => (
            <button key={r.round} type="button" className={cls('chip', r.round === round && 'on')} onClick={() => setRound(r.round)}>
              R{r.round}
            </button>
          ))}
        </div>
        <div className="board-wrap static">
          <Board
            gates={g.gates}
            jeeps={rep.roles.map((r) => ({ id: r.id, colour: r.colour, jeep: rr.jeeps[r.id] ?? null }))}
            selected={null}
            onSelect={() => {}}
            fugitive={rr.fugitive}
            route={path}
            routeTone="past"
            fit={false}
          />
        </div>
        <p className="small">
          Started in <b>{REGIONS[rep.start].name}</b>. Round {round}: he was in <b>{REGIONS[rr.fugitive].name}</b>.
        </p>
      </section>

      <section className="card">
        <h2>Round {round}</h2>
        {rr.news && (
          <p className="small">
            📰 {rr.news.title}
            {rr.news.region ? ` · ${REGIONS[rr.news.region].name}` : ''}
          </p>
        )}
        {rr.steps.length > 0 ? (
          <ul className="small">
            {rr.steps.map((s, i) => (
              <li key={i}>
                Night: {HOW[s.how]} {REGIONS[s.from].name} → {REGIONS[s.to].name}
              </li>
            ))}
          </ul>
        ) : (
          round > 1 && <p className="small">Night: he stayed put.</p>
        )}
        {round > 1 && <p className="small muted">{rr.pinged ? '📡 FASTag pinged.' : 'No ping.'}</p>}
        {rr.releases.length > 0 && (
          <table className="releases">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Received</th>
                <th>Posted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rr.releases.map((r) => (
                <tr key={r.player}>
                  <td>{label(r.player)}</td>
                  <td className="small">
                    {r.received ? describeClue(r.received, label) : '—'}
                    {r.hot ? ' 🔥' : ''}
                  </td>
                  <td className="small">{describeClaim(r.claim, label)}</td>
                  <td>
                    <span className={cls('label', r.label.toLowerCase().replace(' ', '-'))}>{r.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rr.stings.map((s, i) => (
          <p key={i} className="small">
            🎥 {name(s.by)} stung {name(s.target)}: <b>{s.verdict}</b>
          </p>
        ))}
        {rr.suitcase && (
          <p className="small">
            💼 Suitcase from {name(rr.suitcase.from)} to {name(rr.suitcase.to)}: <b>{rr.suitcase.status}</b>
          </p>
        )}
        {rr.warrants.map((w) => (
          <p key={w.id} className="small">
            ⚖ {name(w.proposer)}'s warrant on {REGIONS[w.region].name} (signed: {w.signers.map(name).join(', ')}): <b>{w.status === 'void' ? 'lapsed' : w.status}</b>
          </p>
        ))}
        {rr.circular && (
          <p className="small">
            🔒 Circular on {REGIONS[rr.circular.gate].name}: {rr.circular.passed ? 'passed' : 'failed'} (yes:{' '}
            {Object.entries(rr.circular.votes).filter(([, v]) => v).map(([id]) => name(id)).join(', ') || 'none'})
          </p>
        )}
      </section>

      <section className="card">
        <h2>Inquiry votes</h2>
        <ul className="small">
          {Object.entries(rep.votes).map(([voter, targets]) => (
            <li key={voter}>
              {name(voter)} → {targets.map(name).join(', ')}
            </li>
          ))}
          {Object.keys(rep.votes).length === 0 && <li className="muted">Nobody voted.</li>}
        </ul>
      </section>

      <section className="card">
        <h2>Stats</h2>
        <ul className="small">
          <li>Rounds played: {rep.stats.roundsPlayed}</li>
          <li>FASTag pings: {rep.stats.pings} · Hawala moves: {rep.stats.hawalaUsed}</li>
          <li>
            Planted Leaks: {rep.stats.leaksUsed} ({rep.stats.leaksUnnoticed} passed on as truth)
          </li>
          <li>
            Lies told:{' '}
            {Object.entries(rep.stats.lies)
              .filter(([, n]) => n > 0)
              .map(([id, n]) => `${name(id)} ${n}`)
              .join(', ') || 'none'}
          </li>
        </ul>
      </section>

      <div className="report-actions">
        {room.me === room.hostId ? (
          <button type="button" className="btn primary" onClick={() => hostEmit('host:lobby')}>
            Rematch: back to the lobby
          </button>
        ) : (
          <p className="muted small">Waiting for the host to start a rematch.</p>
        )}
        <button type="button" className="btn ghost" onClick={() => void leaveRoom()}>
          Leave room
        </button>
      </div>
    </div>
  );
}
