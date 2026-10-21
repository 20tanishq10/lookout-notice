import type { RoomView } from '../shared/types';
import { GameScreen } from './components/Game';
import { Home, WaitingClaim } from './components/Home';
import { Lobby } from './components/Lobby';
import { hostEmit, saveSession, useStore } from './net';

function Claims({ room }: { room: RoomView }) {
  if (!room.claims.length) return null;
  const seatName = (id: string) => room.players.find((p) => p.id === id)?.name ?? 'a seat';
  return (
    <div className="claims">
      {room.claims.map((c) => (
        <div key={c.id} className="claim">
          <span>
            <b>{c.name}</b> wants to take over {seatName(c.seat)}'s seat.
          </span>
          <div className="row gap">
            <button type="button" className="btn small primary" onClick={() => hostEmit('host:claim', { claimId: c.id, approve: true })}>
              Let in
            </button>
            <button type="button" className="btn small ghost" onClick={() => hostEmit('host:claim', { claimId: c.id, approve: false })}>
              No
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const restoring = useStore((s) => s.restoring);
  const connected = useStore((s) => s.connected);
  const toast = useStore((s) => s.toast);
  const claimPending = useStore((s) => s.claimPending);

  let screen: JSX.Element;
  if (restoring) {
    screen = (
      <div className="home">
        <div className="card stack center">
          <div className="spinner" />
          <strong>{connected ? 'Rejoining your game…' : 'Connecting…'}</strong>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              saveSession(null);
              location.reload();
            }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  } else if (!view) screen = claimPending ? <WaitingClaim /> : <Home />;
  else if (view.stage === 'lobby' || !view.game) screen = <Lobby room={view} />;
  else screen = <GameScreen room={view} />;

  return (
    <>
      {screen}
      {view && <Claims room={view} />}
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
