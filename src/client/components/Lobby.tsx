import { AGENCIES, AGENCY_IDS, type AgencyId } from '../../shared/agencies';
import { PRESETS, type Settings } from '../../shared/settings';
import type { RoomView } from '../../shared/types';
import { hostEmit, leaveRoom, toast } from '../net';
import { cls } from '../util';

function Option<T extends string | number | boolean>(props: {
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  render?: (v: T) => string;
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="opt">
      <div className="opt-label">
        {props.label}
        {props.hint && <div className="muted tiny">{props.hint}</div>}
      </div>
      <div className="seg">
        {props.options.map((o) => (
          <button
            key={String(o)}
            type="button"
            className={cls('chip', o === props.value && 'on')}
            disabled={props.disabled}
            onClick={() => props.onPick(o)}
          >
            {props.render ? props.render(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Lobby({ room }: { room: RoomView }) {
  const isHost = room.me === room.hostId;
  const s = room.settings;
  const n = room.players.length;
  const update = (patch: Partial<Settings>) => void hostEmit('lobby:settings', patch);
  const onOff = (v: boolean) => (v ? 'On' : 'Off');

  const toggleAgency = (a: AgencyId) => {
    const next = s.agencies.includes(a) ? s.agencies.filter((x) => x !== a) : [...s.agencies, a];
    update({ agencies: next });
  };

  const share = async () => {
    const url = `${location.origin}/?room=${room.code}`;
    const text = `Join my Lookout Notice game: room ${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Lookout Notice', text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast('Invite link copied.', 'info');
      }
    } catch {
      /* the user closed the share sheet */
    }
  };

  const balance = room.balance;
  const balanceText = balance < 40 ? 'Agencies favoured' : balance > 60 ? 'Mantri favoured' : 'Roughly even';

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div>
          <div className="kicker">Room code</div>
          <div className="code">{room.code}</div>
        </div>
        <button type="button" className="btn primary" onClick={share}>
          Invite
        </button>
      </header>

      <section className="card">
        <div className="row between">
          <strong>Players ({n}/8)</strong>
          <span className="muted small">{n < 5 ? `Need ${5 - n} more` : 'Ready when you are'}</span>
        </div>
        <ul className="lobby-players">
          {room.players.map((p) => (
            <li key={p.id}>
              <span className={cls('conn', p.connected ? 'on' : 'off')} />
              <span className="grow">
                {p.name}
                {p.id === room.me && <span className="muted"> (you)</span>}
              </span>
              {p.isHost && <span className="tag">Host</span>}
              {isHost && p.id !== room.me && (
                <button type="button" className="link danger" onClick={() => hostEmit('lobby:kick', { playerId: p.id })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <strong>Presets</strong>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="preset" disabled={!isHost} onClick={() => hostEmit('lobby:preset', { id: p.id })}>
              <b>{p.name}</b>
              <span className="tiny muted">{p.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <strong>Agencies</strong>
          <span className={cls('small', s.agencies.length === n ? 'ok' : 'warn')}>
            {s.agencies.length} picked · {n} player{n === 1 ? '' : 's'}
          </span>
        </div>
        <p className="small muted">Pick one per player. They're dealt at random when the game starts.</p>
        <div className="agency-grid">
          {AGENCY_IDS.map((a) => {
            const on = s.agencies.includes(a);
            return (
              <button key={a} type="button" className={cls('agency', on && 'on')} disabled={!isHost} onClick={() => toggleAgency(a)}>
                <div className="row between">
                  <b>{AGENCIES[a].name}</b>
                  <span className="tag">{AGENCIES[a].type}</span>
                </div>
                <div className="tiny">{AGENCIES[a].clue}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card settings">
        <strong>Settings</strong>
        <Option label="Rounds" value={s.rounds} options={[5, 6, 7] as const} disabled={!isHost} onPick={(rounds) => update({ rounds })} />
        <Option label="Timers" value={s.timers} options={['short', 'standard', 'long'] as const} render={(v) => v[0].toUpperCase() + v.slice(1)} disabled={!isHost} onPick={(timers) => update({ timers })} />
        <Option label="Distances" hint="CBI clues" value={s.distance} options={['exact', 'banded'] as const} render={(v) => (v === 'exact' ? 'Exact' : 'Banded')} disabled={!isHost} onPick={(distance) => update({ distance })} />
        <Option label="Mantri ji" hint="2 needs 7+ players" value={s.mantris} options={[1, 2] as const} disabled={!isHost} onPick={(mantris) => update({ mantris })} />
        <Option label="Planted Leaks" value={s.leaks} options={[0, 1, 2] as const} disabled={!isHost} onPick={(leaks) => update({ leaks })} />
        <Option label="Hawala moves" value={s.hawala} options={[0, 1, 2, 3] as const} disabled={!isHost} onPick={(hawala) => update({ hawala })} />
        <Option label="Suitcase" value={s.suitcase} options={[true, false]} render={onOff} disabled={!isHost} onPick={(suitcase) => update({ suitcase })} />
        <Option label="Exit gates" hint="5 drops Manipur, 7 adds Chennai" value={s.gates} options={[5, 6, 7] as const} disabled={!isHost} onPick={(gates) => update({ gates })} />
        <Option label="Lookout Circulars" value={s.circulars} options={[2, 3, 4] as const} disabled={!isHost} onPick={(circulars) => update({ circulars })} />
        <Option label="Earliest escape" value={s.earliestEscape} options={[3, 4, 5] as const} render={(v) => `R${v}`} disabled={!isHost} onPick={(earliestEscape) => update({ earliestEscape })} />
        <Option label="Media Stings" value={s.stings} options={[1, 2, 3] as const} disabled={!isHost} onPick={(stings) => update({ stings })} />
        <Option label="Breaking News" value={s.news} options={[true, false]} render={onOff} disabled={!isHost} onPick={(news) => update({ news })} />
        <Option label="Hidden agencies" hint="Nobody knows who runs what" value={s.hiddenAgencies} options={[true, false]} render={onOff} disabled={!isHost} onPick={(hiddenAgencies) => update({ hiddenAgencies })} />
      </section>

      <section className="card">
        <div className="row between">
          <strong>Balance</strong>
          <span className="small">{balanceText}</span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ left: `${balance}%` }} />
        </div>
        <div className="row between tiny muted">
          <span>Agencies</span>
          <span>Mantri ji</span>
        </div>
        <p className="tiny muted">A rough estimate for now. It gets tuned once bot simulations run.</p>
        {room.check.errors.map((e) => (
          <p key={e} className="warn small">
            ⛔ {e}
          </p>
        ))}
        {room.check.warnings.map((w) => (
          <p key={w} className="caution small">
            ⚠ {w}
          </p>
        ))}
      </section>

      <div className="lobby-actions">
        {isHost ? (
          <button type="button" className="btn primary big" disabled={room.check.errors.length > 0} onClick={() => hostEmit('game:start')}>
            Start game
          </button>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
        <button type="button" className="btn ghost" onClick={() => void leaveRoom()}>
          Leave
        </button>
      </div>
    </div>
  );
}
