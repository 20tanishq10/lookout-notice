import { useEffect, useState } from 'react';
import { AGENCIES } from '../../shared/agencies';
import { describeClue } from '../../shared/describe';
import { dist } from '../../shared/graph';
import { REGIONS, REGION_CODES, type RegionCode } from '../../shared/regions';
import type { Clue, GameView, NightOrders } from '../../shared/types';
import { act } from '../net';
import { cls, labelOf, nameOf } from '../util';
import { AGENCY_KIND, ClueEditor, defaultClue } from './ClueEditor';

function sameOrders(a: NightOrders | null, b: NightOrders): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, suitcaseTarget: a.suitcaseTarget ?? null }) === JSON.stringify({ ...b, suitcaseTarget: b.suitcaseTarget ?? null });
}

/** Next regions the planned route may step into. */
export function nextSteps(g: GameView, plan: RegionCode[]): RegionCode[] {
  const m = g.mantri;
  if (!m || plan.length >= m.maxSteps) return [];
  const end = plan.length ? plan[plan.length - 1] : m.fugitive;
  const flood = g.phase === 'night' ? g.blocked.flood : undefined;
  if (end === flood) return [];
  return REGIONS[end].borders.filter((b) => b !== flood && (m.reachable.includes(b) || b === m.fugitive));
}

export function MantriOrders(props: {
  g: GameView;
  plan: RegionCode[];
  setPlan: (p: RegionCode[]) => void;
  /** At Night the step's main button saves the orders, so this card shows no Save button. */
  onOrders?: (o: NightOrders) => void;
}) {
  const { g, plan, setPlan, onOrders } = props;
  const m = g.mantri!;
  const [hawala, setHawala] = useState(m.orders?.hawala ?? false);
  const [fly, setFly] = useState(m.orders?.fly ?? false);
  const [target, setTarget] = useState<string>(m.orders?.suitcaseTarget ?? '');

  // Pick up orders saved by this player or a partner Mantri.
  useEffect(() => {
    if (m.orders) {
      setPlan(m.orders.steps);
      setHawala(m.orders.hawala);
      setFly(m.orders.fly);
      setTarget(m.orders.suitcaseTarget ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(m.orders)]);

  const lockedByPartner = m.ordersLocked && m.ordersBy !== g.me.id;
  const preview = g.phase !== 'night';
  const options = nextSteps(g, plan);
  const normalSteps = plan.length - (m.tipOffPending && plan.length > 0 ? 1 : 0);
  const orders: NightOrders = { steps: fly ? [] : plan, hawala: !fly && hawala && normalSteps > 0, fly, suitcaseTarget: target || undefined };
  const saved = sameOrders(m.orders, orders);
  const candidates = g.players.filter((p) => p.id !== g.me.id && !m.partners.includes(p.id) && !m.bought.includes(p.id));
  const ordersKey = JSON.stringify(orders);
  useEffect(() => {
    onOrders?.(orders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersKey]);
  const tools = [
    g.settings.hawala > 0 && `Hawala ${m.hawalaLeft}`,
    g.settings.leaks > 0 && `Leaks ${m.leaksLeft}`,
    g.settings.suitcase && `Suitcase ${m.suitcaseUsed ? 'used' : 'unused'}`,
    m.bought.length > 0 && `Bought: ${m.bought.map((id) => nameOf(g, id)).join(', ')}`,
  ].filter(Boolean);

  return (
    <div className="card mantri">
      <div className="row between">
        <strong>🎩 Night orders{preview ? ' (for the coming night)' : ''}</strong>
        <span className="muted small">He is in {REGIONS[m.fugitive].name}</span>
      </div>
      {lockedByPartner && <p className="warn small">{nameOf(g, m.ordersBy!)} locked tonight's orders.</p>}
      {m.flushed && <p className="warn small">🔥 He was flushed out: he must end the night somewhere else.</p>}
      {m.tipOffPending && <p className="small">⚡ Tip-off: his first step tonight is free and silent.</p>}
      {g.phase === 'night' && g.news && <p className="small muted">📰 {g.news.title}: {g.news.text}</p>}
      {preview && <p className="small muted">Saved now, used at Night{g.settings.news ? ". Tonight's Breaking News could still change what's allowed" : ''}.</p>}

      {m.canFly && (
        <label className="toggle big">
          <input type="checkbox" checked={fly} onChange={(e) => setFly(e.target.checked)} disabled={lockedByPartner} />
          <span>✈ Fly him out from {REGIONS[m.fugitive].gate?.name}</span>
        </label>
      )}

      {!fly && (
        <>
          <div className="small">
            Route:{' '}
            {plan.length === 0 ? (
              <em>stay in {REGIONS[m.fugitive].name}</em>
            ) : (
              plan.map((c, i) => (
                <span key={i} className="pill">
                  {m.tipOffPending && i === 0 ? 'tip-off → ' : ''}
                  {REGIONS[c].name}
                </span>
              ))
            )}
            {plan.length > 0 && (
              <button type="button" className="link" onClick={() => setPlan([])} disabled={lockedByPartner}>
                clear
              </button>
            )}
          </div>
          {options.length > 0 && !lockedByPartner && (
            <div className="seg wrap">
              <span className="small muted">Move him to:</span>
              {options.map((c) => (
                <button key={c} type="button" className="chip" onClick={() => setPlan([...plan, c])}>
                  → {REGIONS[c].name}
                </button>
              ))}
            </div>
          )}
          {m.maxSteps === 0 && <p className="small muted">He can't move tonight.</p>}
          {m.hawalaLeft > 0 && normalSteps > 0 && (
            <label className="toggle">
              <input type="checkbox" checked={hawala} onChange={(e) => setHawala(e.target.checked)} disabled={lockedByPartner} />
              <span>Use Hawala: no FASTag ping ({m.hawalaLeft} left)</span>
            </label>
          )}
        </>
      )}

      {m.suitcaseAvailable && (
        <label className="field">
          <span>💼 Send the Suitcase to</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={lockedByPartner}>
            <option value="">Nobody tonight</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {labelOf(g, p.id)}
              </option>
            ))}
          </select>
        </label>
      )}

      {!onOrders && (
        <button
          type="button"
          className={cls('btn', saved ? 'ghost' : 'primary')}
          disabled={lockedByPartner || saved}
          onClick={() => act({ type: 'nightOrders', orders })}
        >
          {saved ? 'Saved for tonight ✓' : 'Save for tonight'}
        </button>
      )}
      {tools.length > 0 && <p className="small muted">{tools.join(' · ')}</p>}
    </div>
  );
}

export function LeakComposer({ g }: { g: GameView }) {
  const m = g.mantri!;
  const eligible = g.players.filter((p) => p.id !== g.me.id && !m.partners.includes(p.id) && p.agency && p.agency !== 'MEDIA' && !p.suspended);
  const [target, setTarget] = useState(eligible[0]?.id ?? '');
  const t = g.players.find((p) => p.id === target);
  const kind = t?.agency ? AGENCY_KIND[t.agency] : undefined;
  const [fake, setFake] = useState<Clue | null>(null);

  useEffect(() => {
    if (kind) setFake(defaultClue(kind, g, m.edQuestions[target], m.itMetrics[target]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, kind, JSON.stringify(m.edQuestions[target]), m.itMetrics[target]]);

  if (m.leaksLeft < 1) return <div className="card mantri small muted">No Planted Leaks left.</div>;
  if (m.leakUsedThisRound) return <div className="card mantri small muted">Leak already planted this round.</div>;
  if (m.leakArmed) {
    return (
      <div className="card mantri">
        <strong>🧪 Planted Leak armed</strong>
        <p className="small">
          {labelOf(g, m.leakArmed.target)} will receive: <em>{describeClue(m.leakArmed.clue, (id) => labelOf(g, id))}</em>
        </p>
        <p className="small muted">It's checked when clues go out. If it breaks a rule it fails and isn't used up.</p>
        <button type="button" className="btn ghost" onClick={() => act({ type: 'leakDisarm' })}>
          Cancel leak
        </button>
      </div>
    );
  }
  const targetJeep = t?.jeep ?? null;
  const cyberPool = g.phase === 'briefing' && targetJeep ? REGION_CODES.filter((c) => dist(targetJeep, c) <= 3) : undefined;
  return (
    <details className="card mantri">
      <summary>
        <strong>🧪 Plant a leak</strong> <span className="muted small">({m.leaksLeft} left)</span>
      </summary>
      <label className="field">
        <span>Target</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {AGENCIES[p.agency!].name}
            </option>
          ))}
        </select>
      </label>
      {fake && kind && fake.kind === kind && (
        <>
          <div className="small muted">They will receive this instead of their real clue:</div>
          <ClueEditor clue={fake} onChange={setFake} g={g} lockQuestion cyberPool={cyberPool} />
          <button type="button" className="btn primary" onClick={() => act({ type: 'leakArm', target, clue: fake })}>
            Arm leak
          </button>
        </>
      )}
    </details>
  );
}
