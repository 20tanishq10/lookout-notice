export const AGENCY_IDS = [
  'CBI', 'NIA', 'CYBER', 'POLICE', 'CRIME', 'ED', 'IT', 'CUSTOMS', 'RPF', 'RAW', 'IB', 'MEDIA',
] as const;
export type AgencyId = (typeof AGENCY_IDS)[number];

export type AgencyType = 'Locator' | 'Local' | 'Filter' | 'Exit' | 'Tracker' | 'Social';

export interface AgencyDef {
  id: AgencyId;
  name: string;
  short: string;
  type: AgencyType;
  /** What the clue tells you, in one line. */
  clue: string;
  /** The format the answer comes in. */
  format: string;
}

export const AGENCIES: Record<AgencyId, AgencyDef> = {
  CBI: { id: 'CBI', name: 'CBI', short: 'CBI', type: 'Locator', clue: 'How many borders separate your jeep from him', format: '0–7, or a band in Banded mode' },
  NIA: { id: 'NIA', name: 'NIA', short: 'NIA', type: 'Locator', clue: 'His direction from your jeep', format: 'N, NE, E, SE, S, SW, W, NW, or Here' },
  CYBER: { id: 'CYBER', name: 'Cyber Cell', short: 'CYB', type: 'Locator', clue: 'A tower ping, if he is within 3 borders of your jeep', format: '3 regions, one of them his; otherwise "No signal"' },
  POLICE: { id: 'POLICE', name: 'State Police', short: 'POL', type: 'Local', clue: 'Whether he is in your region or a neighbouring one', format: 'Yes / No' },
  CRIME: { id: 'CRIME', name: 'Crime Branch', short: 'CRB', type: 'Local', clue: 'Whether he has been in your region at any point this game', format: 'Now / Earlier / Never' },
  ED: { id: 'ED', name: 'ED', short: 'ED', type: 'Filter', clue: 'One yes/no question from the ED list, about his current region', format: 'Yes / No' },
  IT: { id: 'IT', name: 'Income Tax', short: 'IT', type: 'Filter', clue: 'His region compared with yours on Lok Sabha seats or number of neighbours', format: 'More / Fewer / Same' },
  CUSTOMS: { id: 'CUSTOMS', name: 'Customs', short: 'CUS', type: 'Exit', clue: 'How many borders he is from the nearest unsealed exit gate', format: 'A number of borders (0 if he is on one)' },
  RPF: { id: 'RPF', name: 'RPF', short: 'RPF', type: 'Tracker', clue: "The direction of his move last night, even a silent one", format: 'N … NW, or Did not move' },
  RAW: { id: 'RAW', name: 'RAW', short: 'RAW', type: 'Tracker', clue: "His zone before last night's move", format: 'One of the six zones' },
  IB: { id: 'IB', name: 'IB', short: 'IB', type: 'Social', clue: 'Which jeep is closest to him', format: 'Agency name; a tie names all tied agencies' },
  MEDIA: { id: 'MEDIA', name: 'Media', short: 'MED', type: 'Social', clue: 'No clue. Runs Stings instead and cannot sign warrants', format: '—' },
};

export const LOCATORS: AgencyId[] = ['CBI', 'NIA', 'CYBER'];
export const FILTERS: AgencyId[] = ['ED', 'IT'];
