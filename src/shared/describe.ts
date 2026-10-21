import { REGIONS } from './regions';
import type { Clue, EdQuestion, PressClaim } from './types';

export function describeEdQuestion(q: EdQuestion): string {
  switch (q.q) {
    case 'coastal': return 'Is he in a coastal region?';
    case 'borders': return `Does his region border ${q.country}?`;
    case 'zone': return `Is he in the ${q.zone} zone?`;
    case 'hindi': return 'Is he in the Hindi belt?';
    case 'seats': return `Does his region have at least ${q.n} Lok Sabha seats?`;
    case 'neighbours': return `Does his region have at least ${q.n} neighbours?`;
    case 'gate': return 'Is he in an exit-gate region?';
    case 'sameZone': return 'Is he in the same zone as my jeep?';
  }
}

/** Human-readable clue value. `nameOf` turns player ids into labels (for IB). */
export function describeClue(c: Clue, nameOf: (id: string) => string = (id) => id): string {
  switch (c.kind) {
    case 'CBI':
      if (typeof c.value === 'number') return c.value === 0 ? 'Here (0 borders)' : `${c.value} border${c.value === 1 ? '' : 's'} away`;
      return c.value === 'Here' ? 'Here' : `${c.value} borders away`;
    case 'NIA':
      return c.value === 'Here' ? 'Here' : `Direction ${c.value}`;
    case 'CYBER':
      return c.value === 'No signal' ? 'No signal' : `Tower ping: ${c.value.map((r) => REGIONS[r].name).join(', ')}`;
    case 'POLICE':
      return c.value ? 'Yes, in or next to my region' : 'No, not in or next to my region';
    case 'CRIME':
      return c.value === 'Now' ? 'Now (he is here)' : c.value === 'Earlier' ? 'Earlier (he has been here)' : 'Never been here';
    case 'ED':
      return `${describeEdQuestion(c.question)} ${c.value ? 'Yes' : 'No'}`;
    case 'IT':
      return `${c.value} ${c.metric === 'seats' ? 'Lok Sabha seats' : 'neighbours'} than my region`;
    case 'CUSTOMS':
      return c.value === 0 ? 'On an open exit gate' : `${c.value} border${c.value === 1 ? '' : 's'} from the nearest open gate`;
    case 'RPF':
      return c.value === 'Did not move' || c.value === 'No movement yet' ? c.value : `Moved ${c.value} last night`;
    case 'RAW':
      return `${c.value} zone, before last night's move`;
    case 'IB':
      return `Closest jeep: ${c.value.map(nameOf).join(', ')}`;
  }
}

export function describeClaim(p: PressClaim, nameOf?: (id: string) => string): string {
  if (p.none) return 'No comment';
  return `${describeClue(p.clue, nameOf)}${p.hot ? ' · claims Hot Trail' : ''}`;
}
