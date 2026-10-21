import { useState } from 'react';
import { emit, enterRoom, loadName, saveName, setClaimPending, toast, type Session } from '../net';
import { Tutorial } from './Tutorial';

export function Home() {
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState((params.get('room') ?? '').toUpperCase().slice(0, 4));
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState<{ id: string; name: string }[] | null>(null);
  const [help, setHelp] = useState(false);

  const go = async (event: 'room:create' | 'room:join') => {
    const n = name.trim();
    if (!n) return toast('Enter your name first.');
    saveName(n);
    setBusy(true);
    const res = await emit<Session>(event, { name: n, code });
    setBusy(false);
    if (res.ok && res.data) {
      history.replaceState(null, '', '/');
      enterRoom(res.data);
    } else if (!res.ok && res.error === 'in-progress') {
      setSeats(((res.data as { seats?: { id: string; name: string }[] })?.seats) ?? []);
    } else if (!res.ok) toast(res.error);
  };

  const claim = async (seat: string) => {
    const res = await emit('room:claim', { code, name: name.trim(), seat });
    if (res.ok) setClaimPending(true);
    else toast(res.error);
  };

  return (
    <div className="home">
      <div className="brand">
        <div className="logo">🔎</div>
        <h1>Lookout Notice</h1>
        <p className="tagline">Seth Bhagodalal looted ₹40,000 crore and vanished somewhere in India. Catch him before Mantri ji flies him out.</p>
        <p className="muted small">5–8 players · about 18 minutes · play on a call or in the same room</p>
      </div>

      <div className="card stack">
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="e.g. Tanishq" autoComplete="nickname" />
        </label>
        <button type="button" className="btn primary big" disabled={busy} onClick={() => go('room:create')}>
          Create a room
        </button>
        <div className="or">or join one</div>
        <div className="row gap">
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            placeholder="CODE"
            inputMode="text"
            autoCapitalize="characters"
          />
          <button type="button" className="btn" disabled={busy || code.length !== 4} onClick={() => go('room:join')}>
            Join
          </button>
        </div>
      </div>

      {seats && (
        <div className="card stack">
          <strong>That game has already started</strong>
          {seats.length === 0 ? (
            <p className="small muted">Every seat is taken. Ask the host to start a rematch after this game.</p>
          ) : (
            <>
              <p className="small">Take over a seat whose player dropped out. The host has to approve it.</p>
              {seats.map((s) => (
                <button key={s.id} type="button" className="btn" onClick={() => claim(s.id)}>
                  Take {s.name}'s seat
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <button type="button" className="btn ghost" onClick={() => setHelp(true)}>
        How to play
      </button>
      {help && <Tutorial onClose={() => setHelp(false)} />}
    </div>
  );
}

export function WaitingClaim() {
  return (
    <div className="home">
      <div className="card stack center">
        <div className="spinner" />
        <strong>Waiting for the host to let you in…</strong>
        <button type="button" className="btn ghost" onClick={() => setClaimPending(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
