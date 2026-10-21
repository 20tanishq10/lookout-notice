import { useEffect, useState, type ReactNode } from 'react';
import { describeClue } from '../../shared/describe';
import { REGIONS, REGION_CODES, type RegionCode } from '../../shared/regions';
import type { Clue, ClueKind, GameView, NightOrders } from '../../shared/types';
import { act } from '../net';
import { cls, labelOf, nameOf } from '../util';
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

/** The one-line "what do I do now" card at the top of every step. */
function StepCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="stepcard">
      <div className="step-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <div className="small">{children}</div>
      </div>
    </div>
  );
}

/** The step's single main button, pinned above the tab bar. */
function MainBar({ children, status }: { children?: ReactNode; status?: string }) {
  return (
    <div className="mainbar">
      {children}
      {status && <span className="muted small">{status}</span>}
    </div>
  );
}

function waitingFor(g: GameView, count: number): string {
  return count === 0 ? 'Everyone is done' : `Waiting for ${count} player${count === 1 ? '' : 's'}`;
}

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

function SuitcaseCard({ g }: { g: GameView }) {
  if (g.suitcaseOffer?.status !== 'pending') return null;
  return (
    <div className="card suitcase">
      <strong>💼 A sealed suitcase has arrived</strong>
      <p className="small">
        Take it and you switch sides: you learn who Mantri ji is and where Bhagodalal hides, and you score if he gets away. Refuse and you get +2
        points plus a hint about who sent it.
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
  if (!g.bought) return null;
  return (
    <div className="card bought">
      <strong>💰 You're Bought</strong>
      <div className="small">
        Mantri ji: {g.bought.mantris.map((id) => nameOf(g, id)).join(', ')} · He is in <b>{REGIONS[g.bought.fugitive].name}</b>
      </div>
    </div>
  );
}

function MyClue({ g }: { g: GameView }) {
  if (!g.myClue) return null;
  return (
    <div className={cls('card intel', g.myClue.hot && 'hot')}>
      <div className="kicker">Your clue · from {REGIONS[g.myClue.from].name}</div>
      <strong>{describeClue(g.myClue.clue, (id) => labelOf(g, id))}</strong>
      {g.myClue.hot && <div className="hot-msg">🔥 Hot Trail: he is in {REGIONS[g.myClue.from].name} right now!</div>}
    </div>
  );
}

function MantriPreview({ g, plan, setPlan }: Pick<PanelProps, 'g' | 'plan' | 'setPlan'>) {
  if (!g.mantri || g.round >= g.rounds) return null;
  return (
    <details className="plain">
      <summary>🎩 Plan tonight's move early</summary>
      <MantriOrders g={g} plan={plan} setPlan={setPlan} />
    </details>
  );
}

// ───────────── Step 1: Night ─────────────

function NightStep({ g, plan, setPlan }: PanelProps) {
  const [orders, setOrders] = useState<NightOrders | null>(null);
  const m = g.mantri;
  if (!m) {
    return (
      <>
        <StepCard icon="🌙" title="Night">
          Mantri ji is secretly moving Bhagodalal. Hang on a moment.
        </StepCard>
        <NewsCard g={g} />
        <SecretCard g={g} />
        <MainBar status="Waiting for Mantri ji…" />
      </>
    );
  }
  const lockedByPartner = m.ordersLocked && m.ordersBy !== g.me.id;
  const confirm = async () => {
    if (orders && !lockedByPartner && !(await act({ type: 'nightOrders', orders }))) return;
    await act({ type: 'ready', ready: true });
  };
  return (
    <>
      <StepCard icon="🌙" title="Night: move Bhagodalal">
        Pick where he goes tonight, or leave him where he is. Then tap Confirm.
      </StepCard>
      <NewsCard g={g} />
      <MantriOrders g={g} plan={plan} setPlan={setPlan} onOrders={setOrders} />
      <MainBar>
        {g.me.ready ? (
          <button type="button" className="btn ghost" onClick={() => act({ type: 'ready', ready: false })}>
            ✓ Confirmed (tap to change)
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => void confirm()}>
            Confirm night move
          </button>
        )}
      </MainBar>
    </>
  );
}

// ───────────── Step 2: Move ─────────────

function MoveStep({ g }: PanelProps) {
  const me = g.players.find((p) => p.id === g.me.id)!;
  const options = g.deployOptions ? [...g.deployOptions].sort(byName) : null;
  const waiting = g.players.filter((p) => !p.ready && !p.suspended).length;
  if (!options) {
    return (
      <>
        <StepCard icon="🚙" title="Move: you sit this one out">
          You signed a wrong warrant, so your jeep stays put and you get no clue this round.
        </StepCard>
        <MainBar status={waitingFor(g, waiting)} />
      </>
    );
  }
  const dest = g.myDeploy ?? me.jeep;
  return (
    <>
      <StepCard icon="🚙" title={g.round === 1 ? 'Place your jeep' : 'Move your jeep'}>
        {g.round === 1 ? 'Tap any region on the map.' : 'Tap a lit-up region on the map (up to 2 borders away).'} Your clue arrives once everyone
        has moved.
      </StepCard>
      <NewsCard g={g} />
      <div className="card">
        <div className="row between">
          <span>
            {dest ? (
              <>
                {dest === me.jeep && g.round > 1 ? 'Staying in ' : 'Heading to '}
                <b>{REGIONS[dest].name}</b>
              </>
            ) : (
              <span className="muted">No region picked yet</span>
            )}
          </span>
        </div>
        <details>
          <summary className="small">Pick from a list instead</summary>
          <select value={dest ?? ''} onChange={(e) => act({ type: 'deploy', region: e.target.value as RegionCode })}>
            {!dest && <option value="">Choose a region</option>}
            {options.map((c) => (
              <option key={c} value={c}>
                {REGIONS[c].name}
                {c === me.jeep ? ' (stay)' : ''}
              </option>
            ))}
          </select>
        </details>
      </div>
      {g.me.agency === 'ED' && (
        <div className="card">
          <strong>💸 Your ED question this round</strong>
          <EdQuestionPicker value={g.myEdQuestion ?? { q: 'coastal' }} onChange={(question) => act({ type: 'edQuestion', question })} />
        </div>
      )}
      {g.me.agency === 'IT' && (
        <div className="card">
          <strong>🧾 Compare his region with yours on</strong>
          <div className="seg">
            {(['seats', 'neighbours'] as const).map((m) => (
              <button key={m} type="button" className={cls('chip', (g.myItMetric ?? 'seats') === m && 'on')} onClick={() => act({ type: 'itMetric', metric: m })}>
                {m === 'seats' ? 'Lok Sabha seats' : 'Neighbours'}
              </button>
            ))}
          </div>
        </div>
      )}
      {g.mantri && g.settings.leaks > 0 && <LeakComposer g={g} />}
      <SecretCard g={g} />
      <MainBar status={waitingFor(g, waiting)}>
        {g.me.ready ? (
          <button type="button" className="btn ghost" onClick={() => act({ type: 'ready', ready: false })}>
            ✓ Confirmed (tap to change)
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={!dest} onClick={() => act({ type: 'ready', ready: true })}>
            Confirm move
          </button>
        )}
      </MainBar>
    </>
  );
}

// ───────────── Step 3a: Report ─────────────

const ALL_KINDS: ClueKind[] = ['CBI', 'NIA', 'CYBER', 'POLICE', 'CRIME', 'ED', 'IT', 'CUSTOMS', 'RPF', 'RAW', 'IB'];

function ReportStep({ g }: PanelProps) {
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
  const notPosted = g.players.filter((p) => !p.posted && !p.suspended && p.agency !== 'MEDIA').length;

  if (!truth) {
    return (
      <>
        <StepCard icon="📰" title="Report">
          {g.me.agency === 'MEDIA' ? "Media gets no clue. Everyone's posts appear in a moment." : 'You have no clue this round.'}
        </StepCard>
        <SecretCard g={g} />
        <MainBar status={`Waiting for posts…`} />
      </>
    );
  }
  const posted = g.myPress;
  const post = (claim: Parameters<typeof act>[0]) => act(claim).then(() => setEditing(false));
  return (
    <>
      <StepCard icon="📰" title="Report your clue">
        Post it for everyone: the truth, a lie, or nothing. All posts appear together, so nobody can copy.
      </StepCard>
      <MyClue g={g} />
      {posted && !editing ? (
        <div className="card">
          <div className="kicker">You posted</div>
          <strong>{posted.none ? 'No comment' : describeClue(posted.clue, (id) => labelOf(g, id)) + (posted.hot ? ' · claims Hot Trail' : '')}</strong>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Change it
          </button>
        </div>
      ) : (
        draft && (
          <details className="card">
            <summary>Post a lie or stay quiet instead</summary>
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
            <div className="row gap wrap">
              <button type="button" className="btn" onClick={() => void post({ type: 'press', claim: { clue: draft, hot } })}>
                Post this version
              </button>
              <button type="button" className="btn ghost" onClick={() => void post({ type: 'press', claim: { none: true } })}>
                Post "No comment"
              </button>
            </div>
          </details>
        )
      )}
      <SecretCard g={g} />
      <MainBar status={posted && !editing ? `Posted ✓ · ${waitingFor(g, notPosted)}` : undefined}>
        {(!posted || editing) && (
          <button type="button" className="btn primary" onClick={() => void post({ type: 'press', claim: { clue: truth.clue, hot: truth.hot } })}>
            Post the truth
          </button>
        )}
      </MainBar>
    </>
  );
}

// ───────────── Step 3b: Discuss ─────────────

function DiscussStep({ g, plan, setPlan }: PanelProps) {
  const canSting = g.me.agency === 'MEDIA' && g.stingsLeft > 0 && !g.stingUsedThisRound;
  const stings = g.feed.filter((f) => f.kind === 'sting' && f.round === g.round && f.sting);
  const waiting = g.players.filter((p) => !p.ready).length;
  return (
    <>
      <StepCard icon="🗣" title="Discuss">
        Compare everyone's posts with your own clue. Who's lying? Talk on your call, or DM people in Chat.
      </StepCard>
      <SuitcaseCard g={g} />
      <MyClue g={g} />
      <div className="card">
        <div className="row between">
          <strong>Everyone's posts</strong>
          {g.me.agency === 'MEDIA' && <span className="muted small">{g.stingsLeft} Sting{g.stingsLeft === 1 ? '' : 's'} left</span>}
        </div>
        <PressList g={g} rows={g.press} onSting={canSting ? (id) => act({ type: 'sting', target: id }) : undefined} />
      </div>
      {stings.map((f) => (
        <StingCard key={f.id} g={g} s={f.sting!} />
      ))}
      <MantriPreview g={g} plan={plan} setPlan={setPlan} />
      <SecretCard g={g} />
      <MainBar status={waitingFor(g, waiting)}>
        {g.me.ready ? (
          <button type="button" className="btn ghost" onClick={() => act({ type: 'ready', ready: false })}>
            ✓ Done (tap to undo)
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => act({ type: 'ready', ready: true })}>
            Done discussing
          </button>
        )}
      </MainBar>
    </>
  );
}

// ───────────── Step 4: Act ─────────────

function ActStep({ g, plan, setPlan, warrantRegion, setWarrantRegion }: PanelProps) {
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
  const waiting = g.players.filter((p) => !p.ready).length;
  const toggleInvite = (id: string) =>
    setInvite((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));

  return (
    <>
      <StepCard icon="⚖" title="Act">
        Raid a region with a warrant, or vote to seal an exit gate. Nothing to do? Just tap Done.
      </StepCard>
      <SuitcaseCard g={g} />

      {invitations.map((w) => (
        <div key={w.id} className="card invite-card">
          <strong>
            {nameOf(g, w.proposer)} wants you to raid {REGIONS[w.region].name}
          </strong>
          <div className="small muted">Right region: +6 for you. Wrong: −3 and you sit out a round.</div>
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

      {mine.map((w) => (
        <div key={w.id} className="card">
          <strong>⚖ Your warrant: {REGIONS[w.region].name}</strong>
          <div className="small">
            Signed by {w.signers.map((id) => nameOf(g, id)).join(', ')}
            {w.invited.length > 0 && <> · waiting on {w.invited.map((id) => nameOf(g, id)).join(', ')}</>}
          </div>
          <div className="small">{w.signers.length >= 2 ? '✓ The raid happens when this step ends' : 'Needs one more signature'}</div>
        </div>
      ))}

      {c && (
        <div className="card">
          <strong>
            🔒 Seal {REGIONS[c.gate].gate?.name} ({REGIONS[c.gate].name})?
          </strong>
          <div className="small muted">Proposed by {nameOf(g, c.proposer)}. Passes with a strict majority; no vote counts as no.</div>
          <div className="small">
            Yes: {Object.entries(c.votes).filter(([, v]) => v).map(([id]) => nameOf(g, id)).join(', ') || '—'} · No:{' '}
            {Object.entries(c.votes).filter(([, v]) => !v).map(([id]) => nameOf(g, id)).join(', ') || '—'}
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
        </div>
      )}

      {canPropose && (
        <details className="card" open={!!warrantRegion}>
          <summary>⚖ Propose a warrant</summary>
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
            <div className="small muted">Invite 1 or 2 people to sign with you. It goes ahead with 2 or 3 signatures.</div>
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
        </details>
      )}
      {!canPropose && (court || isMedia || g.me.suspended) && (
        <p className="small muted">
          {court ? 'Court Stay: no warrants this round.' : isMedia ? "Media can't sign warrants." : "You're sitting out this round."}
        </p>
      )}

      {!c && g.circularsLeft > 0 && !g.me.suspended && (
        <details className="card">
          <summary>🔒 Seal an exit gate ({g.circularsLeft} left)</summary>
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
          <div className="small muted">Everyone votes. A sealed gate stays shut for the rest of the game.</div>
        </details>
      )}

      <MantriPreview g={g} plan={plan} setPlan={setPlan} />
      <SecretCard g={g} />
      <MainBar status={waitingFor(g, waiting)}>
        {g.me.ready ? (
          <button type="button" className="btn ghost" onClick={() => act({ type: 'ready', ready: false })}>
            ✓ Done (tap to undo)
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => act({ type: 'ready', ready: true })}>
            Done
          </button>
        )}
      </MainBar>
    </>
  );
}

// ───────────── Inquiry ─────────────

function InquiryStep({ g }: PanelProps) {
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
    <>
      <div className={cls('card outcome', o.type)}>
        <strong>{text}</strong>
      </div>
      <StepCard icon="🏛" title="Who was Mantri ji?">
        Pick {picks === 1 ? 'one player' : `${picks} players`}. You get +2 for each correct name.
      </StepCard>
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
      <MainBar status={`${g.inquiry?.voted ?? 0} of ${g.inquiry?.needed ?? g.players.length} voted`}>
        <button type="button" className="btn primary" disabled={sel.length !== picks} onClick={() => act({ type: 'inquiryVote', targets: sel })}>
          {voted ? 'Update vote' : 'Cast vote'}
        </button>
      </MainBar>
    </>
  );
}

export function PhasePanel(props: PanelProps) {
  switch (props.g.phase) {
    case 'night': return <NightStep {...props} />;
    case 'deploy': case 'briefing': return <MoveStep {...props} />;
    case 'press': return <ReportStep {...props} />;
    case 'talk': return <DiscussStep {...props} />;
    case 'action': return <ActStep {...props} />;
    case 'inquiry': return <InquiryStep {...props} />;
    default: return null;
  }
}
