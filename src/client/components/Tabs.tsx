import { useEffect, useMemo, useRef, useState } from 'react';
import { AGENCIES, AGENCY_IDS } from '../../shared/agencies';
import { describeClue } from '../../shared/describe';
import { REGIONS, REGION_CODES, type RegionCode } from '../../shared/regions';
import type { FeedItem, GameView } from '../../shared/types';
import { act } from '../net';
import { cls, colourOf, labelOf, nameOf } from '../util';
import type { Mark } from './Board';
import { PressList, StingCard } from './PressList';

const FEED_ICON: Partial<Record<FeedItem['kind'], string>> = {
  round: '🌙', news: '📰', ping: '📡', noping: '🔇', press: '📰', sting: '🎥', warrant: '⚖', circular: '🔒',
  circularProposed: '🗳', escape: '✈', arrest: '🚔', survived: '⌛', transfer: '🔁', cctv: '📹', tip: '🕵', calls: '📞', suspend: '⛔',
};

export function FeedTab({ g }: { g: GameView }) {
  const items = [...g.feed].reverse();
  return (
    <ul className="feed">
      {items.map((f) => (
        <li key={f.id} className={cls('feed-item', `fk-${f.kind}`)}>
          <span className="rnd">R{f.round}</span>
          <div className="grow">
            {f.kind === 'press' && f.press ? (
              <>
                <div className="small muted">📰 {f.text}</div>
                <PressList g={g} rows={f.press} />
              </>
            ) : f.kind === 'sting' && f.sting ? (
              <StingCard g={g} s={f.sting} />
            ) : (
              <div>
                {/^\p{Extended_Pictographic}/u.test(f.text) ? '' : `${FEED_ICON[f.kind] ?? '•'} `}
                {f.text}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function IntelTab({ g }: { g: GameView }) {
  const items = [...g.private].reverse();
  return (
    <div className="stack">
      <RoleCard g={g} />
      {items.length === 0 && <p className="muted small">Your private intel will show up here.</p>}
      <ul className="feed">
        {items.map((p) => (
          <li key={p.id} className={cls('feed-item', `fk-${p.kind}`)}>
            <span className="rnd">R{p.round}</span>
            <div className="grow">
              {p.kind === 'clue' && p.clue ? (
                <>
                  <div className="small muted">Clue from {p.from ? REGIONS[p.from].name : '?'}</div>
                  <strong>{describeClue(p.clue, (id) => labelOf(g, id))}</strong>
                </>
              ) : (
                p.text
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoleCard({ g }: { g: GameView }) {
  const [show, setShow] = useState(false);
  const a = AGENCIES[g.me.agency];
  const roleText =
    g.me.role === 'mantri'
      ? '🎩 You are secretly Mantri ji. Keep Bhagodalal free: fly him out through an unsealed gate, or keep him hidden to the end.'
      : g.me.role === 'bought'
        ? '💰 You took the Suitcase. You now score with Mantri ji.'
        : '🕵 You are an honest agency. Sign the warrant that catches him, and expose Mantri ji.';
  return (
    <div className="card role">
      <div className="row between">
        <div>
          <div className="kicker">Your agency</div>
          <strong>{a.name}</strong> <span className="tag">{a.type}</span>
        </div>
        <button type="button" className="btn small ghost" onClick={() => setShow((s) => !s)}>
          {show ? 'Hide role' : 'Show secret role'}
        </button>
      </div>
      <div className="small">{a.clue}.</div>
      {show && <div className="secret small">{roleText}</div>}
    </div>
  );
}

export function ChatTab({ g, initialPeer }: { g: GameView; initialPeer?: string | null }) {
  const [peer, setPeer] = useState<string | null>(initialPeer ?? null);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const thread = useMemo(() => g.dms.filter((d) => d.from === peer || d.to === peer), [g.dms, peer]);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [thread.length, peer]);

  if (!peer) {
    return (
      <div className="stack">
        <p className="small muted">Private messages. Only you and the other person can see them.</p>
        <ul className="people">
          {g.players
            .filter((p) => p.id !== g.me.id)
            .map((p) => {
              const last = [...g.dms].reverse().find((d) => d.from === p.id || d.to === p.id);
              return (
                <li key={p.id} onClick={() => setPeer(p.id)}>
                  <span className="dot" style={{ background: p.colour }} />
                  <div className="grow">
                    <strong>{labelOf(g, p.id)}</strong>
                    <div className="small muted ellipsis">{last ? `${last.from === g.me.id ? 'You: ' : ''}${last.text}` : 'No messages yet'}</div>
                  </div>
                  <span className="muted">›</span>
                </li>
              );
            })}
        </ul>
      </div>
    );
  }
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (await act({ type: 'dm', to: peer, text: t })) setText('');
  };
  return (
    <div className="chat">
      <button type="button" className="link" onClick={() => setPeer(null)}>
        ‹ All chats
      </button>
      <div className="row gap">
        <span className="dot" style={{ background: colourOf(g, peer) }} />
        <strong>{labelOf(g, peer)}</strong>
      </div>
      <div className="msgs">
        {thread.map((d) => (
          <div key={d.id} className={cls('msg', d.from === g.me.id && 'mine')}>
            {d.text}
            <span className="muted tiny"> R{d.round}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={`Message ${nameOf(g, peer)}`} />
        <button type="submit" className="btn primary">
          Send
        </button>
      </form>
    </div>
  );
}

export function InfoTab({ g, marks, clearMarks }: { g: GameView; marks: Partial<Record<RegionCode, Mark>>; clearMarks: () => void }) {
  const [sort, setSort] = useState<'name' | 'zone' | 'seats'>('name');
  const rows = useMemo(() => {
    const list = [...REGION_CODES];
    if (sort === 'name') list.sort((a, b) => REGIONS[a].name.localeCompare(REGIONS[b].name));
    if (sort === 'zone') list.sort((a, b) => REGIONS[a].zone.localeCompare(REGIONS[b].zone) || REGIONS[a].name.localeCompare(REGIONS[b].name));
    if (sort === 'seats') list.sort((a, b) => REGIONS[b].seats - REGIONS[a].seats);
    return list;
  }, [sort]);
  const gates = new Map(g.gates.map((x) => [x.code, x.sealed]));
  const inPlay = g.settings.agencies.length ? g.settings.agencies : null;
  const marked = Object.keys(marks).length;
  return (
    <div className="stack">
      <div className="card">
        <strong>Agencies in this game</strong>
        {inPlay ? (
          <ul className="agency-list">
            {AGENCY_IDS.filter((a) => inPlay.includes(a)).map((a) => (
              <li key={a}>
                <b>{AGENCIES[a].name}</b> <span className="tag">{AGENCIES[a].type}</span>
                <div className="small muted">{AGENCIES[a].clue}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Hidden agencies: nobody knows which agencies are in play.</p>
        )}
      </div>
      <div className="card">
        <div className="row between">
          <strong>Your notebook</strong>
          {marked > 0 && (
            <button type="button" className="link" onClick={clearMarks}>
              Clear {marked} mark{marked === 1 ? '' : 's'}
            </button>
          )}
        </div>
        <p className="small muted">Tap a region on the map to mark it ✕ ruled out, ? possible or ★ suspect. Only you see your marks.</p>
      </div>
      <div className="card">
        <div className="row between">
          <strong>Gazetteer</strong>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="small-select">
            <option value="name">By name</option>
            <option value="zone">By zone</option>
            <option value="seats">By seats</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="gaz">
            <thead>
              <tr>
                <th>Region</th>
                <th>Zone</th>
                <th>Coast</th>
                <th>Seats</th>
                <th>Hindi</th>
                <th>Nbrs</th>
                <th>Foreign</th>
                <th>Gate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const r = REGIONS[c];
                const gate = gates.has(c) ? (gates.get(c) ? '🔒' : '✈') : '';
                return (
                  <tr key={c}>
                    <td>
                      <b>{c}</b> {r.name}
                    </td>
                    <td>{r.zone}</td>
                    <td>{r.coastal ? 'Yes' : ''}</td>
                    <td>{r.seats}</td>
                    <td>{r.hindiBelt ? 'Yes' : ''}</td>
                    <td>{r.borders.length}</td>
                    <td className="small">{r.foreign.join(', ')}</td>
                    <td>{gate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card small">
        <strong>Quick rules</strong>
        <ul className="rules">
          <li>A round has 4 steps: 🌙 Night → 🚙 Move → 📰 Report & discuss → ⚖ Act.</li>
          <li>Jeeps move up to 2 borders. Landing on him gives a private 🔥 Hot Trail and flushes him out.</li>
          <li>A warrant needs 2–3 signatures. Right region wins it; wrong costs each signer 3 points and a round.</li>
          <li>From Round {g.settings.earliestEscape}, he flies out from an unsealed gate he held for a full round with no jeep on it.</li>
          <li>Every move he makes posts a 📡 FASTag ping{g.settings.hawala > 0 ? ' unless Mantri ji uses Hawala' : ''}.</li>
        </ul>
      </div>
    </div>
  );
}
