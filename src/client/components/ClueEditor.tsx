import { AGENCIES, type AgencyId } from '../../shared/agencies';
import { describeEdQuestion } from '../../shared/describe';
import { DIRS } from '../../shared/graph';
import { COUNTRIES, REGIONS, REGION_CODES, ZONES, type RegionCode } from '../../shared/regions';
import { CBI_BANDS, type Clue, type ClueKind, type EdQuestion, type GameView } from '../../shared/types';
import { cls, labelOf } from '../util';

export const KIND_AGENCY: Record<ClueKind, AgencyId> = {
  CBI: 'CBI', NIA: 'NIA', CYBER: 'CYBER', POLICE: 'POLICE', CRIME: 'CRIME', ED: 'ED', IT: 'IT', CUSTOMS: 'CUSTOMS',
  RPF: 'RPF', RAW: 'RAW', IB: 'IB',
};

export const AGENCY_KIND: Partial<Record<AgencyId, ClueKind>> = Object.fromEntries(
  Object.entries(KIND_AGENCY).map(([k, a]) => [a, k as ClueKind]),
);

export function defaultClue(kind: ClueKind, g: GameView, ed?: EdQuestion | null, metric?: 'seats' | 'neighbours' | null): Clue {
  switch (kind) {
    case 'CBI': return { kind, value: g.settings.distance === 'exact' ? 1 : '1–2' };
    case 'NIA': return { kind, value: 'N' };
    case 'CYBER': return { kind, value: 'No signal' };
    case 'POLICE': return { kind, value: false };
    case 'CRIME': return { kind, value: 'Never' };
    case 'ED': return { kind, question: ed ?? { q: 'coastal' }, value: false };
    case 'IT': return { kind, metric: metric ?? 'seats', value: 'Same' };
    case 'CUSTOMS': return { kind, value: 1 };
    case 'RPF': return { kind, value: 'Did not move' };
    case 'RAW': return { kind, value: 'North' };
    case 'IB': return { kind, value: [g.players[0].id] };
  }
}

function Seg<T extends string | number | boolean>(props: { options: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; disabled?: (v: T) => boolean }) {
  return (
    <div className="seg wrap">
      {props.options.map((o) => (
        <button
          key={String(o)}
          type="button"
          className={cls('chip', o === props.value && 'on')}
          disabled={props.disabled?.(o)}
          onClick={() => props.onChange(o)}
        >
          {props.label ? props.label(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function EdQuestionPicker(props: { value: EdQuestion; onChange: (q: EdQuestion) => void }) {
  const q = props.value;
  const types: { id: EdQuestion['q']; label: string }[] = [
    { id: 'coastal', label: 'Coastal?' },
    { id: 'borders', label: 'Borders a country?' },
    { id: 'zone', label: 'In a zone?' },
    { id: 'hindi', label: 'Hindi belt?' },
    { id: 'seats', label: 'At least N seats?' },
    { id: 'neighbours', label: 'At least N neighbours?' },
    { id: 'gate', label: 'Exit-gate region?' },
    { id: 'sameZone', label: 'Same zone as my jeep?' },
  ];
  const pick = (id: EdQuestion['q']) => {
    switch (id) {
      case 'borders': return props.onChange({ q: 'borders', country: 'Nepal' });
      case 'zone': return props.onChange({ q: 'zone', zone: 'North' });
      case 'seats': return props.onChange({ q: 'seats', n: 20 });
      case 'neighbours': return props.onChange({ q: 'neighbours', n: 4 });
      default: return props.onChange({ q: id } as EdQuestion);
    }
  };
  return (
    <div className="stack-s">
      <select value={q.q} onChange={(e) => pick(e.target.value as EdQuestion['q'])}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      {q.q === 'borders' && (
        <Seg options={COUNTRIES} value={q.country} onChange={(country) => props.onChange({ q: 'borders', country })} />
      )}
      {q.q === 'zone' && <Seg options={ZONES} value={q.zone} onChange={(zone) => props.onChange({ q: 'zone', zone })} />}
      {q.q === 'seats' && <Seg options={[5, 10, 14, 20, 25, 30, 40]} value={q.n} onChange={(n) => props.onChange({ q: 'seats', n })} />}
      {q.q === 'neighbours' && <Seg options={[2, 3, 4, 5, 6, 7]} value={q.n} onChange={(n) => props.onChange({ q: 'neighbours', n })} />}
      <div className="muted small">{describeEdQuestion(q)}</div>
    </div>
  );
}

function RegionSelect(props: { value: RegionCode | ''; onChange: (c: RegionCode) => void; options?: RegionCode[] }) {
  const opts = props.options ?? [...REGION_CODES].sort((a, b) => REGIONS[a].name.localeCompare(REGIONS[b].name));
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value as RegionCode)}>
      <option value="" disabled>Pick a region</option>
      {opts.map((c) => (
        <option key={c} value={c}>{REGIONS[c].name}</option>
      ))}
    </select>
  );
}

/**
 * Edits a clue in its own format. `lockQuestion` keeps ED's question / Income Tax's metric fixed (used for leaks).
 */
export function ClueEditor(props: { clue: Clue; onChange: (c: Clue) => void; g: GameView; lockQuestion?: boolean; cyberPool?: RegionCode[] }) {
  const { clue: c, onChange, g } = props;
  switch (c.kind) {
    case 'CBI':
      return g.settings.distance === 'exact' ? (
        <Seg options={[0, 1, 2, 3, 4, 5, 6, 7]} value={c.value as number} onChange={(value) => onChange({ kind: 'CBI', value })} label={(v) => (v === 0 ? 'Here' : String(v))} />
      ) : (
        <Seg options={CBI_BANDS} value={c.value as (typeof CBI_BANDS)[number]} onChange={(value) => onChange({ kind: 'CBI', value })} />
      );
    case 'NIA':
      return (
        <div className="compass">
          {(['NW', 'N', 'NE', 'W', 'Here', 'E', 'SW', 'S', 'SE'] as const).map((d) => (
            <button key={d} type="button" className={cls('chip', c.value === d && 'on')} onClick={() => onChange({ kind: 'NIA', value: d })}>
              {d}
            </button>
          ))}
        </div>
      );
    case 'CYBER': {
      const list = c.value === 'No signal' ? [] : c.value;
      const setAt = (i: number, code: RegionCode) => {
        const next = [...list];
        next[i] = code;
        onChange({ kind: 'CYBER', value: [...new Set(next.filter(Boolean))] });
      };
      return (
        <div className="stack-s">
          <Seg options={['Ping', 'No signal'] as const} value={c.value === 'No signal' ? 'No signal' : 'Ping'} onChange={(v) => onChange(v === 'No signal' ? { kind: 'CYBER', value: 'No signal' } : { kind: 'CYBER', value: list.length ? list : [g.players[0].jeep ?? 'MP'] })} />
          {c.value !== 'No signal' &&
            [0, 1, 2].map((i) => <RegionSelect key={i} value={list[i] ?? ''} onChange={(code) => setAt(i, code)} options={props.cyberPool} />)}
        </div>
      );
    }
    case 'POLICE':
      return <Seg options={[true, false]} value={c.value} onChange={(value) => onChange({ kind: 'POLICE', value })} label={(v) => (v ? 'Yes' : 'No')} />;
    case 'CRIME':
      return <Seg options={['Now', 'Earlier', 'Never'] as const} value={c.value} onChange={(value) => onChange({ kind: 'CRIME', value })} />;
    case 'ED':
      return (
        <div className="stack-s">
          {props.lockQuestion ? <div className="muted small">{describeEdQuestion(c.question)}</div> : <EdQuestionPicker value={c.question} onChange={(question) => onChange({ ...c, question })} />}
          <Seg options={[true, false]} value={c.value} onChange={(value) => onChange({ ...c, value })} label={(v) => (v ? 'Yes' : 'No')} />
        </div>
      );
    case 'IT':
      return (
        <div className="stack-s">
          {!props.lockQuestion && (
            <Seg options={['seats', 'neighbours'] as const} value={c.metric} onChange={(metric) => onChange({ ...c, metric })} label={(v) => (v === 'seats' ? 'Lok Sabha seats' : 'Neighbours')} />
          )}
          <Seg options={['More', 'Fewer', 'Same'] as const} value={c.value} onChange={(value) => onChange({ ...c, value })} />
        </div>
      );
    case 'CUSTOMS':
      return <Seg options={[0, 1, 2, 3, 4, 5, 6, 7]} value={c.value} onChange={(value) => onChange({ kind: 'CUSTOMS', value })} label={(v) => (v === 0 ? 'On a gate' : String(v))} />;
    case 'RPF':
      return <Seg options={[...DIRS, 'Did not move', 'No movement yet'] as const} value={c.value} onChange={(value) => onChange({ kind: 'RPF', value })} />;
    case 'RAW':
      return <Seg options={ZONES} value={c.value} onChange={(value) => onChange({ kind: 'RAW', value })} />;
    case 'IB':
      return (
        <div className="seg wrap">
          {g.players.map((p) => {
            const on = c.value.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={cls('chip', on && 'on')}
                onClick={() => {
                  const next = on ? c.value.filter((x) => x !== p.id) : [...c.value, p.id];
                  if (next.length) onChange({ kind: 'IB', value: next });
                }}
              >
                {labelOf(g, p.id)}
              </button>
            );
          })}
        </div>
      );
  }
}

export function kindLabel(kind: ClueKind): string {
  return AGENCIES[KIND_AGENCY[kind]].name;
}
