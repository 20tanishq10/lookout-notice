import { useCallback, useEffect, useMemo, useState } from 'react';
import { AGENCIES } from '../../shared/agencies';
import { REGIONS, type RegionCode } from '../../shared/regions';
import type { GameView, RoomView } from '../../shared/types';
import { act, hostEmit, useStore } from '../net';
import { PHASE_LABEL, cls, fmtTime, labelOf, nameOf, useSecondsLeft } from '../util';
import { Board, type Mark } from './Board';
import { nextSteps } from './MantriTools';
import { PhasePanel } from './PhasePanel';
import { Report } from './Report';
import { ChatTab, FeedTab, InfoTab, IntelTab } from './Tabs';

type Tab = 'phase' | 'feed' | 'intel' | 'chat' | 'info';

function useMarks(key: string): [Partial<Record<RegionCode, Mark>>, (c: RegionCode, m: Mark | null) => void, () => void] {
  const storageKey = `ln-marks-${key}`;
  const [marks, setMarks] = useState<Partial<Record<RegionCode, Mark>>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    } catch {
      return {};
    }
  });
  const persist = (next: Partial<Record<RegionCode, Mark>>) => {
    setMarks(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* fine: marks just won't survive a reload */
    }
  };
  const set = (c: RegionCode, m: Mark | null) => {
    const next = { ...marks };
    if (m) next[c] = m;
    else delete next[c];
    persist(next);
  };
  return [marks, set, () => persist({})];
}

/** Count of items newer than what the player last looked at. */
function useUnread(ids: number[], active: boolean): number {
  const latest = ids.length ? Math.max(...ids) : 0;
  const [seen, setSeen] = useState(latest);
  useEffect(() => {
    if (active) setSeen(latest);
  }, [active, latest]);
  return ids.filter((id) => id > seen).length;
}

function TopBar({ room, g }: { room: RoomView; g: GameView }) {
  const secs = useSecondsLeft(g);
  const connected = useStore((s) => s.connected);
  const isHost = room.me === room.hostId;
  const [menu, setMenu] = useState(false);
  const urgent = secs <= 5 && g.phase !== 'report';
  return (
    <header className="topbar">
      <div className="tb-left">
        <div className="tb-round">
          Round {g.round}/{g.rounds}
        </div>
        <div className="tb-phase">{PHASE_LABEL[g.phase]}</div>
      </div>
      <div className={cls('tb-timer', urgent && 'urgent', g.paused && 'paused')}>{g.paused ? '⏸ Paused' : fmtTime(secs)}</div>
      <div className="tb-right">
        {!connected && <span className="offline">Reconnecting…</span>}
        <span className="tb-agency">{AGENCIES[g.me.agency].short}</span>
        {isHost && (
          <button type="button" className="icon-btn" aria-label="Host menu" onClick={() => setMenu((m) => !m)}>
            ⋮
          </button>
        )}
      </div>
      {menu && isHost && (
        <div className="menu" onClick={() => setMenu(false)}>
          <button type="button" onClick={() => hostEmit('host:pause', { paused: !g.paused })}>
            {g.paused ? '▶ Resume game' : '⏸ Pause game'}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm('End this game for everyone and go back to the lobby?')) void hostEmit('host:lobby');
            }}
          >
            ✖ End game
          </button>
        </div>
      )}
    </header>
  );
}

function PlayersStrip({ g, focus, setFocus }: { g: GameView; focus: string | null; setFocus: (id: string | null) => void }) {
  return (
    <div className="players-strip">
      {g.players.map((p) => (
        <button
          key={p.id}
          type="button"
          className={cls('pchip', focus === p.id && 'on', !p.connected && 'off', p.suspended && 'susp')}
          onClick={() => setFocus(focus === p.id ? null : p.id)}
        >
          <span className="dot" style={{ background: p.colour }} />
          <span className="pname">{p.id === g.me.id ? 'You' : p.name}</span>
          {p.agency && <span className="pag">{AGENCIES[p.agency].short}</span>}
          {p.suspended && <span title="Suspended">⛔</span>}
          {!p.connected && <span title="Offline">⚡</span>}
          {(g.phase === 'talk' || g.phase === 'action' || g.phase === 'deploy') && p.ready && <span title="Done">✓</span>}
          {g.phase === 'press' && p.posted && <span title="Posted">📝</span>}
        </button>
      ))}
    </div>
  );
}

function RegionCard(props: {
  g: GameView;
  code: RegionCode;
  mark: Mark | undefined;
  setMark: (m: Mark | null) => void;
  onClose: () => void;
  onWarrant: () => void;
  onPlanStep: (() => void) | null;
}) {
  const { g, code } = props;
  const r = REGIONS[code];
  const gate = g.gates.find((x) => x.code === code);
  const here = g.players.filter((p) => p.jeep === code);
  const canDeploy = g.phase === 'deploy' && g.deployOptions?.includes(code);
  const canWarrant = g.phase === 'action' && g.me.agency !== 'MEDIA' && !g.me.suspended && !g.signedThisRound && g.news?.id !== 'COURT';
  const canSeal = g.phase === 'action' && gate && !gate.sealed && !g.circular && g.circularsLeft > 0 && !g.me.suspended;
  return (
    <div className="region-card">
      <div className="row between">
        <div>
          <strong>{r.name}</strong> <span className="muted small">{code}</span>
        </div>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="facts small">
        <span>{r.zone}</span>
        {r.coastal && <span>Coastal</span>}
        <span>{r.seats} seats</span>
        {r.hindiBelt && <span>Hindi belt</span>}
        <span>{r.borders.length} neighbours</span>
        {r.foreign.length > 0 && <span>Borders {r.foreign.join(', ')}</span>}
        {gate && <span className={gate.sealed ? 'sealed' : 'gatepill'}>{gate.sealed ? '🔒 Sealed gate' : `✈ ${r.gate?.name}`}</span>}
      </div>
      {here.length > 0 && <div className="small">Jeeps here: {here.map((p) => (p.id === g.me.id ? 'you' : labelOf(g, p.id))).join(', ')}</div>}
      <div className="row gap wrap">
        {(['x', 'q', 'star'] as Mark[]).map((m) => (
          <button key={m} type="button" className={cls('chip', props.mark === m && 'on')} onClick={() => props.setMark(props.mark === m ? null : m)}>
            {m === 'x' ? '✕ Ruled out' : m === 'q' ? '? Possible' : '★ Suspect'}
          </button>
        ))}
      </div>
      <div className="row gap wrap">
        {canDeploy && (
          <button type="button" className="btn primary small" onClick={() => act({ type: 'deploy', region: code })}>
            {g.players.find((p) => p.id === g.me.id)?.jeep === code ? 'Keep jeep here' : 'Move jeep here'}
          </button>
        )}
        {canWarrant && (
          <button type="button" className="btn danger small" onClick={props.onWarrant}>
            Warrant on {r.name}
          </button>
        )}
        {canSeal && (
          <button type="button" className="btn small" onClick={() => act({ type: 'circularPropose', gate: code })}>
            Propose sealing this gate
          </button>
        )}
        {props.onPlanStep && (
          <button type="button" className="btn small mantri-btn" onClick={props.onPlanStep}>
            🎩 Move him here
          </button>
        )}
      </div>
    </div>
  );
}

export function GameScreen({ room }: { room: RoomView }) {
  const g = room.game!;
  const [tab, setTab] = useState<Tab>('phase');
  const [selected, setSelected] = useState<RegionCode | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [plan, setPlan] = useState<RegionCode[]>([]);
  const [warrantRegion, setWarrantRegion] = useState<RegionCode | null>(null);
  const [marks, setMark, clearMarks] = useMarks(`${room.code}-${room.me}`);

  // Reset per-phase helpers when the phase changes.
  useEffect(() => {
    setTab('phase');
    if (g.phase === 'night' && !g.mantri?.orders) setPlan([]);
    if (g.phase !== 'action') setWarrantRegion(null);
  }, [g.phase, g.round]); // eslint-disable-line react-hooks/exhaustive-deps

  const feedUnread = useUnread(g.feed.map((f) => f.id), tab === 'feed');
  const intelUnread = useUnread(g.private.map((p) => p.id), tab === 'intel');
  const chatUnread = useUnread(g.dms.filter((d) => d.to === g.me.id).map((d) => d.id), tab === 'chat');

  const secret = g.mantri?.fugitive ?? g.bought?.fugitive ?? null;
  const planning = !!g.mantri && (g.phase === 'night' || g.phase === 'talk' || g.phase === 'action') && !(g.mantri.ordersLocked && g.mantri.ordersBy !== g.me.id);
  const stepOptions = useMemo(() => (planning ? nextSteps(g, plan) : []), [planning, g, plan]);

  const highlight = useMemo(() => {
    if (g.phase === 'deploy' && g.deployOptions) return g.deployOptions;
    if (g.phase === 'night' && g.mantri && reveal) return stepOptions;
    return null;
  }, [g.phase, g.deployOptions, g.mantri, reveal, stepOptions]);

  const onSelect = useCallback(
    (c: RegionCode) => {
      setSelected((cur) => (cur === c ? null : c));
    },
    [],
  );

  if (g.phase === 'report' && g.report) return <Report room={room} g={g} />;

  const route = secret && reveal && g.mantri ? [g.mantri.fugitive, ...plan] : undefined;

  return (
    <div className="game">
      <TopBar room={room} g={g} />
      <div className={cls('map-area', !mapOpen && 'collapsed', (g.phase === 'deploy' || g.phase === 'night' || selected) && 'tall')}>
        {mapOpen && (
          <div className="board-wrap">
            <Board
              gates={g.gates}
              jeeps={g.players.map((p) => ({ id: p.id, colour: p.colour, jeep: p.jeep }))}
              selected={selected}
              onSelect={onSelect}
              highlight={highlight}
              marks={marks}
              fugitive={reveal ? secret : null}
              route={route}
              routeTone="plan"
              flood={g.blocked.flood}
              mcc={g.blocked.mcc}
              zoomed={zoomed}
              focusJeep={focus}
            />
          </div>
        )}
        <div className="map-tools">
          <button type="button" className="icon-btn" aria-label={mapOpen ? 'Hide map' : 'Show map'} onClick={() => setMapOpen((o) => !o)}>
            {mapOpen ? '▲' : '▼ Show map'}
          </button>
          {mapOpen && (
            <button type="button" className="icon-btn" aria-label={zoomed ? 'Zoom out' : 'Zoom in'} onClick={() => setZoomed((z) => !z)}>
              {zoomed ? '−' : '+'}
            </button>
          )}
          {secret && mapOpen && (
            <button type="button" className={cls('icon-btn', reveal && 'on')} onClick={() => setReveal((r) => !r)}>
              {reveal ? '🙈 Hide' : '👁 Him'}
            </button>
          )}
        </div>
      </div>
      {selected && (
        <RegionCard
          g={g}
          code={selected}
          mark={marks[selected]}
          setMark={(m) => setMark(selected, m)}
          onClose={() => setSelected(null)}
          onWarrant={() => {
            setWarrantRegion(selected);
            setSelected(null);
            setTab('phase');
          }}
          onPlanStep={
            planning && stepOptions.includes(selected)
              ? () => {
                  setPlan([...plan, selected]);
                  setSelected(null);
                }
              : null
          }
        />
      )}
      <PlayersStrip g={g} focus={focus} setFocus={setFocus} />
      <main className="panel">
        {tab === 'phase' && <PhasePanel g={g} plan={plan} setPlan={setPlan} warrantRegion={warrantRegion} setWarrantRegion={setWarrantRegion} />}
        {tab === 'feed' && <FeedTab g={g} />}
        {tab === 'intel' && <IntelTab g={g} />}
        {tab === 'chat' && <ChatTab g={g} initialPeer={focus && focus !== g.me.id ? focus : null} />}
        {tab === 'info' && <InfoTab g={g} marks={marks} clearMarks={clearMarks} />}
      </main>
      <nav className="tabs">
        {(
          [
            ['phase', '🎯', PHASE_LABEL[g.phase], 0],
            ['feed', '📰', 'Feed', feedUnread],
            ['intel', '🗂', 'Intel', intelUnread],
            ['chat', '💬', 'Chat', chatUnread],
            ['info', '📖', 'Info', 0],
          ] as [Tab, string, string, number][]
        ).map(([id, icon, label, badge]) => (
          <button key={id} type="button" className={cls('tab', tab === id && 'on')} onClick={() => setTab(id)}>
            <span className="tab-icon">{icon}</span>
            <span className="tab-label">{label}</span>
            {badge > 0 && <span className="badge-n">{badge}</span>}
          </button>
        ))}
      </nav>
      {g.paused && (
        <div className="paused-banner">
          ⏸ Paused by {nameOf(g, room.hostId)}
        </div>
      )}
    </div>
  );
}
