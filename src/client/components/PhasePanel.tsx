import { useEffect, useState } from 'react';
import { AGENCIES } from '../../shared/agencies';
import { describeClue } from '../../shared/describe';
import { REGIONS, REGION_CODES, type RegionCode } from '../../shared/regions';
import type { Clue, ClueKind, GameView } from '../../shared/types';
import { act } from '../net';
import { cls, labelOf, nameOf, PHASE_HINT } from '../util';
import { ClueEditor, EdQuestionPicker, defaultClue, kindLabel } from './ClueEditor';
import { LeakComposer, MantriOrders } from './MantriTools';
import { PressList, StingCard } from './PressList';

export interface PanelProps {
  g: GameView;
  plan: RegionCode[];
  setPlan: (p: RegionCode[]) => void;
  warrantRegion: RegionCode | null;
  setWarrantRegion: (c: RegionCode | null) => void;
}

const byName = (a: RegionCode, b: RegionCode) => REGIONS[a].name.localeCompare(REGIONS[b].name);

export function NewsCard({ g }: { g: GameView }) {
  if (!g.news) return null;
  return (
    <div className="card news">
      <div className="kicker">📰 Breaking News · Round {g.round}</div>
      <strong>
        {g.news.title}
        {g.news.region ? ` · ${REGIONS[g.news.region].name}` : ''}
      </strong>
      <div className="small">{g.news.text}</div>
    </div>
  );
}

function ReadyButton({ g, label }: { g: GameView; label: string }) {
  const ready = g.me.ready;
  const waiting = g.players.filter((p) => !p.ready && !(g.phase === 'deploy' && p.suspended)).length;
  return (
    <div className="ready-row">
      <button type="button" className={cls('btn', ready ? 'ghost' : 'primary')} onClick={() => act({ type: 'ready', ready: !ready })}>
        {ready ? '✓ Done (tap to undo)' : label}
      </button>
      <span className="muted small">{waiting === 0 ? 'Everyone is done' : `Waiting for ${waiting}`}</span>
    </div>
  );
}

function SuitcaseCard({ g }: { g: GameView }) {
  if (g.suitcaseOffer?.status !== 'pending') return null;
  return (
    <div className="card suitcase">
      <strong>💼 A sealed suitcase has arrived</strong>
      <p className="small">
        Accept and you switch sides: you learn who Mantri ji is and where Bhagodalal hides, and you score when he gets away. Refuse
        and you earn +2 Imaandar points plus a hint about who sent it. No answer by the end of Action counts as Refuse.
      </p>
      <div className="row gap">
        <button type="button" className="btn danger" onClick={() => act({ type: 'suitcaseRespond', accept: true })}>
          Take it
        </button>
        <button type="button" className="btn primary" onClick={() => act({ type: 'suitcaseRespond', accept: false })}>
          Refuse
        </button>
      </div>
    </div>
  );
}

export function SecretCard({ g }: { g: GameView }) {
  if (g.bought) {
    return (
      <div className="card bought">
        <strong>💰 You're Bought</strong>
        <div className="small">
          Mantri ji: {g.bought.mantris.map((id) => nameOf(g, id)).join(', ')} · He is in <b>{REGIONS[g.bought.fugitive].name}</b>
        </div>
      </div>
    );
  }
  return null;
}

function MyClue({ g }: { g: GameView }) {
  if (!g.myClue) return null;
  return (
    <div className={cls('card intel', g.myClue.hot && 'hot')}>
      <div className="kicker">Your intel · from {REGIONS[g.myClue.from].name}</div>
      <strong>{describeClue(g.myClue.clue, (id) => labelOf(g, id))}</strong>
      {g.myClue.hot && <div className="hot-msg">🔥 Hot Trail: he is in {REGIONS[g.myClue.from].name} right now!</div>}
    </div>
  );
}

function NightPanel({ g, plan, setPlan }: PanelProps) {
  return (
    <div className="stack">
      <div className="hero">
        <div className="moon">🌙</div>
        <div>
          <strong>Night {g.round}</strong>
          <div className="muted small">Mantri ji is moving Bhagodalal in the dark.</div>
        </div>
      </div>
      <NewsCard g={g} />
      {g.me.suspended && <p className="warn small">You're suspended this round after a wrong warrant.</p>}
      {g.mantri && <MantriOrders g={g} plan={plan} setPlan={setPlan} />}
      <SecretCard g={g} />
    </div>
  );
}

function DeployPanel({ g }: PanelProps) {
  const me = g.players.find((p) => p.id === g.me.id)!;
  const options = g.deployOptions ? [...g.deployOptions].sort(byName) : null;
  return (
    <div className="stack">
      <NewsCard g={g} />
      {!options ? (
        <p className="warn">You're suspended this round. Your jeep stays where it is.</p>
      ) : (
        <div className="card">
          <strong>🚙 Move your jeep</strong>
          <p className="small muted">
            {g.round === 1 ? 'Place it anywhere on the map.' : `It's in ${me.jeep ? REGIONS[me.jeep].name : '?'}. Tap a lit-up region, or pick one below.`}
          </p>
          <select value={g.myDeploy ?? me.jeep ?? ''} onChange={(e) => act({ type: 'deploy', region: e.target.value as RegionCode })}>
            {!g.myDeploy && !me.jeep && <option value="">Choose a region</option>}
            {options.map((c) => (
              <option key={c} value={c}>
                {REGIONS[c].name}
                {c === me.jeep ? ' (stay)' : ''}
              </option>
            ))}
          </select>
          {g.myDeploy && <p className="small">Heading to <b>{REGIONS[g.myDeploy].name}</b>.</p>}
        </div>
      )}
      {g.me.agency === 'ED' && options && (
        <div className="card">
          <strong>💸 ED question for this round</strong>
          <EdQuestionPicker value={g.myEdQuestion ?? { q: 'coastal' }} onChange={(question) => act({ type: 'edQuestion', question })} />
        </div>
      )}
      {g.me.agency === 'IT' && options && (
        <div className="card">
          <strong>🧾 Income Tax comparison</strong>
          <div className="seg">
            {(['seats', 'neighbours'] as const).map((m) => (
              <button key={m} type="button" className={cls('chip', (g.myItMetric ?? 'seats') === m && 'on')} onClick={() => act({ type: 'itMetric', metric: m })}>
                {m === 'seats' ? 'Lok Sabha seats' : 'Neighbours'}
              </button>
            ))}
          </div>
        </div>
      )}
      {g.mantri && <LeakComposer g={g} />}
      <SecretCard g={g} />
      {options && <ReadyButton g={g} label="Confirm deployment" />}
    </div>
  );
}

function BriefingPanel({ g }: PanelProps) {
  return (
    <div className="stack">
      <div className="hero">
        <div className="spinner" />
        <div>
          <strong>Intel incoming…</strong>
          <div className="muted small">Every agency's clue arrives at the same moment.</div>
        </div>
      </div>
      {g.mantri && <LeakComposer g={g} />}
      <SecretCard g={g} />
    </div>
  );
}

const ALL_KINDS: ClueKind[] = ['CBI', 'NIA', 'CYBER', 'POLICE', 'CRIME', 'ED', 'IT', 'CUSTOMS', 'RPF', 'RAW', 'IB'];

function PressPanel({ g }: PanelProps) {
  const truth = g.myClue;
  const [draft, setDraft] = useState<Clue | null>(truth?.clue ?? null);
  const [hot, setHot] = useState(truth?.hot ?? false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setDraft(truth?.clue ?? null);
    setHot(truth?.hot ?? false);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.round, JSON.stringify(truth)]);

  if (!truth) {
    return (
      <div className="stack">
        <p className="muted">{g.me.agency === 'MEDIA' ? '📺 Media has no clue to post. Stings open during Thana Talk.' : "You have no clue to report this round."}</p>
        <SecretCard g={g} />
      </div>
    );
  }
  const posted = g.myPress;
  const posting = !posted || editing;
  return (
    <div className="stack">
      <MyClue g={g} />
      {posted && !editing && (
        <div className="card">
          <div className="kicker">Your Press Release</div>
          <strong>{posted.none ? 'No comment' : describeClue(posted.clue, (id) => labelOf(g, id)) + (posted.hot ? ' · claims Hot Trail' : '')}</strong>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Change it
          </button>
        </div>
      )}
      {posting && draft && (
        <div className="card">
          <strong>📰 Press Release</strong>
          <p className="small muted">Everyone sees every release at once. You can tell the truth, lie, or stay quiet.</p>
          <button type="button" className="btn primary" onClick={() => act({ type: 'press', claim: { clue: truth.clue, hot: truth.hot } }).then(() => setEditing(false))}>
            Post the truth
          </button>
          <details>
            <summary>Post something else…</summary>
            {g.settings.hiddenAgencies && (
              <label className="field">
                <span>Format (you can pose as another agency)</span>
                <select value={draft.kind} onChange={(e) => setDraft(defaultClue(e.target.value as ClueKind, g))}>
                  {ALL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ClueEditor clue={draft} onChange={setDraft} g={g} />
            <label className="toggle">
              <input type="checkbox" checked={hot} onChange={(e) => setHot(e.target.checked)} />
              <span>Claim a 🔥 Hot Trail</span>
            </label>
            <button type="button" className="btn" onClick={() => act({ type: 'press', claim: { clue: draft, hot } }).then(() => setEditing(false))}>
              Post this version
            </button>
          </details>
          <button type="button" className="btn ghost" onClick={() => act({ type: 'press', claim: { none: true } }).then(() => setEditing(false))}>
            No comment
          </button>
        </div>
      )}
      <SecretCard g={g} />
    </div>
  );
}

function TalkPanel({ g, plan, setPlan }: PanelProps) {
  const canSting = g.me.agency === 'MEDIA' && g.stingsLeft > 0 && !g.stingUsedThisRound;
  const stings = g.feed.filter((f) => f.kind === 'sting' && f.round === g.round && f.sting);
  return (
    <div className="stack">
      <SuitcaseCard g={g} />
      <MyClue g={g} />
      <div className="card">
        <div className="row between">
          <strong>📰 Press Releases</strong>
          {g.me.agency === 'MEDIA' && <span className="muted small">{g.stingsLeft} Sting{g.stingsLeft === 1 ? '' : 's'} left</span>}
        </div>
        <PressList g={g} rows={g.press} onSting={canSting ? (id) => act({ type: 'sting', target: id }) : undefined} />
      </div>
      {stings.map((f) => (
        <StingCard key={f.id} g={g} s={f.sting!} />
      ))}
      {g.mantri && g.round < g.rounds && (
        <details className="plain">
          <summary>🎩 Plan tonight's move now</summary>
          <MantriOrders g={g} plan={plan} setPlan={setPlan} />
        </details>
      )}
      <SecretCard g={g} />
      <ReadyButton g={g} label="I'm done talking" />
    </div>
  );
}

function ActionPanel({ g, plan, setPlan, warrantRegion, setWarrantRegion }: PanelProps) {
  const court = g.news?.id === 'COURT';
  const isMedia = g.me.agency === 'MEDIA';
  const canPropose = !court && !isMedia && !g.me.suspended && !g.signedThisRound;
  const hidden = g.settings.hiddenAgencies;
  const eligible = g.players.filter((p) => p.id !== g.me.id && !p.suspended && (hidden || p.agency !== 'MEDIA'));
  const [invite, setInvite] = useState<string[]>([]);
  const [gate, setGate] = useState<RegionCode | ''>('');
  const invitations = g.warrants.filter((w) => w.status === 'open' && w.invited.includes(g.me.id));
  const mine = g.warrants.filter((w) => w.signers.includes(g.me.id));
  const openGates = g.gates.filter((x) => !x.sealed).map((x) => x.code);
  const c = g.circular;

  const toggleInvite = (id: string) =>
    setInvite((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));

  return (
    <div className="stack">
      <SuitcaseCard g={g} />
      <div className="card">
        <strong>⚖ Arrest warrant</strong>
        {court && <p className="warn small">Court Stay: no warrants this round.</p>}
        {isMedia && <p className="small muted">Media can't sign warrants.</p>}
        {g.me.suspended && <p className="small muted">You're suspended this round.</p>}
        {mine.map((w) => (
          <div key={w.id} className="warrant">
            <div>
              <b>{REGIONS[w.region].name}</b> · signed by {w.signers.map((id) => nameOf(g, id)).join(', ')}
            </div>
            {w.invited.length > 0 && <div className="small muted">Waiting on {w.invited.map((id) => nameOf(g, id)).join(', ')}</div>}
            <div className="small">{w.signers.length >= 2 ? '✓ Will execute at the end of Action' : 'Needs one more signature'}</div>
          </div>
        ))}
        {invitations.map((w) => (
          <div key={w.id} className="warrant invite">
            <div>
              {nameOf(g, w.proposer)} invites you to raid <b>{REGIONS[w.region].name}</b>
            </div>
            <div className="small muted">Right region: +6 for you. Wrong: −3 and a round's suspension.</div>
            <div className="row gap">
              <button type="button" className="btn primary small" disabled={g.signedThisRound} onClick={() => act({ type: 'warrantRespond', warrantId: w.id, accept: true })}>
                Sign
              </button>
              <button type="button" className="btn ghost small" onClick={() => act({ type: 'warrantRespond', warrantId: w.id, accept: false })}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {canPropose && (
          <div className="stack-s">
            <label className="field">
              <span>Region to raid</span>
              <select value={warrantRegion ?? ''} onChange={(e) => setWarrantRegion((e.target.value || null) as RegionCode | null)}>
                <option value="">Pick a region (or tap it on the map)</option>
                {[...REGION_CODES].sort(byName).map((code) => (
                  <option key={code} value={code}>
                    {REGIONS[code].name}
                  </option>
                ))}
              </select>
            </label>
            <div className="small muted">Invite 1 or 2 co-signers (it executes with 2 or 3 signatures):</div>
            <div className="seg wrap">
              {eligible.map((p) => (
                <button key={p.id} type="button" className={cls('chip', invite.includes(p.id) && 'on')} onClick={() => toggleInvite(p.id)}>
                  {labelOf(g, p.id)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn danger"
              disabled={!warrantRegion || invite.length === 0}
              onClick={() => act({ type: 'warrantPropose', region: warrantRegion!, invite }).then((ok) => ok && setInvite([]))}
            >
              Propose warrant
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <strong>🔒 Lookout Circular</strong>
          <span className="muted small">{g.circularsLeft} left</span>
        </div>
        {c ? (
          <div className="stack-s">
            <div>
              {nameOf(g, c.proposer)} proposes sealing <b>{REGIONS[c.gate].gate?.name}</b> ({REGIONS[c.gate].name})
            </div>
            <div className="small">
              Yes: {Object.entries(c.votes).filter(([, v]) => v).map(([id]) => nameOf(g, id)).join(', ') || '—'}
              <br />
              No: {Object.entries(c.votes).filter(([, v]) => !v).map(([id]) => nameOf(g, id)).join(', ') || '—'}
            </div>
            {!g.me.suspended && (
              <div className="row gap">
                <button type="button" className={cls('btn small', c.votes[g.me.id] === true ? 'primary' : 'ghost')} onClick={() => act({ type: 'circularVote', yes: true })}>
                  Seal it
                </button>
                <button type="button" className={cls('btn small', c.votes[g.me.id] === false ? 'primary' : 'ghost')} onClick={() => act({ type: 'circularVote', yes: false })}>
                  Keep it open
                </button>
              </div>
            )}
            <div className="muted small">Passes with a strict majority. Silence counts as no.</div>
          </div>
        ) : g.circularsLeft > 0 && !g.me.suspended ? (
          <div className="row gap">
            <select value={gate} onChange={(e) => setGate(e.target.value as RegionCode)}>
              <option value="">Pick an open gate</option>
              {openGates.map((code) => (
                <option key={code} value={code}>
                  {REGIONS[code].gate?.name} ({REGIONS[code].name})
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!gate} onClick={() => gate && act({ type: 'circularPropose', gate })}>
              Propose
            </button>
          </div>
        ) : (
          <p className="small muted">{g.circularsLeft > 0 ? "You can't propose while suspended." : 'No circulars left.'}</p>
        )}
      </div>

      {g.mantri && g.round < g.rounds && (
        <details className="plain">
          <summary>🎩 Plan tonight's move now</summary>
          <MantriOrders g={g} plan={plan} setPlan={setPlan} />
        </details>
      )}
      <SecretCard g={g} />
      <ReadyButton g={g} label="I'm done" />
    </div>
  );
}

function InquiryPanel({ g }: PanelProps) {
  const picks = g.inquiry?.picks ?? 1;
  const [sel, setSel] = useState<string[]>(g.inquiry?.myVote ?? []);
  const voted = (g.inquiry?.myVote.length ?? 0) > 0;
  const o = g.outcome!;
  const text =
    o.type === 'arrest'
      ? `🚔 Arrested in ${REGIONS[o.region].name} by ${o.by?.map((id) => nameOf(g, id)).join(', ')}.`
      : o.type === 'escape'
        ? `✈ Bhagodalal escaped from ${REGIONS[o.region].name}.`
        : `⌛ Bhagodalal stayed free (he was in ${REGIONS[o.region].name}).`;
  return (
    <div className="stack">
      <div className={cls('card outcome', o.type)}>
        <strong>{text}</strong>
      </div>
      <div className="card">
        <strong>🏛 Inquiry Commission</strong>
        <p className="small">Who is Mantri ji? Name {picks === 1 ? 'one player' : `${picks} players`}. +2 for each correct name.</p>
        <div className="seg wrap">
          {g.players
            .filter((p) => p.id !== g.me.id)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={cls('chip', sel.includes(p.id) && 'on')}
                onClick={() => setSel((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id].slice(-picks)))}
              >
                {labelOf(g, p.id)}
              </button>
            ))}
        </div>
        <button type="button" className="btn primary" disabled={sel.length !== picks} onClick={() => act({ type: 'inquiryVote', targets: sel })}>
          {voted ? 'Update vote' : 'Cast vote'}
        </button>
        <p className="muted small">
          {g.inquiry?.voted ?? 0} of {g.inquiry?.needed ?? g.players.length} have voted.
        </p>
      </div>
    </div>
  );
}

export function PhasePanel(props: PanelProps) {
  const { g } = props;
  const header = (
    <p className="phase-hint">
      {PHASE_HINT[g.phase]}
      {g.me.agency && <span className="muted"> · You are {AGENCIES[g.me.agency].name}</span>}
    </p>
  );
  let body: JSX.Element;
  switch (g.phase) {
    case 'night': body = <NightPanel {...props} />; break;
    case 'deploy': body = <DeployPanel {...props} />; break;
    case 'briefing': body = <BriefingPanel {...props} />; break;
    case 'press': body = <PressPanel {...props} />; break;
    case 'talk': body = <TalkPanel {...props} />; break;
    case 'action': body = <ActionPanel {...props} />; break;
    case 'inquiry': body = <InquiryPanel {...props} />; break;
    default: body = <div />;
  }
  return (
    <div>
      {header}
      {body}
    </div>
  );
}

