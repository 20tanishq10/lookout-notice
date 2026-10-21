// Board data for Lookout Notice. Mirrors Appendix A (Gazetteer) and Appendix B (borders) of the rulebook.

export const REGION_CODES = [
  'AP', 'AR', 'AS', 'BR', 'CG', 'DL', 'GA', 'GJ', 'HR', 'HP', 'JK', 'JH', 'KA', 'KL', 'LA', 'MP',
  'MH', 'MN', 'ML', 'MZ', 'NL', 'OD', 'PB', 'RJ', 'SK', 'TN', 'TG', 'TR', 'UP', 'UK', 'WB',
] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export const ZONES = ['North', 'Central', 'East', 'West', 'South', 'Northeast'] as const;
export type Zone = (typeof ZONES)[number];

export const COUNTRIES = ['Pakistan', 'China', 'Nepal', 'Bangladesh', 'Bhutan', 'Myanmar'] as const;
export type Country = (typeof COUNTRIES)[number];

export interface Region {
  code: RegionCode;
  name: string;
  zone: Zone;
  coastal: boolean;
  foreign: Country[];
  seats: number;
  hindiBelt: boolean;
  borders: RegionCode[];
  /** Exit gate. `tier` = smallest exit-gate setting that includes it (5, 6 or 7). */
  gate?: { name: string; tier: 5 | 6 | 7 };
  /** Approximate centre, [°N, °E]. Used only for compass directions. */
  ref: [number, number];
  /** Position on the schematic board (SVG units). */
  pos: [number, number];
}

const R = (
  code: RegionCode,
  name: string,
  zone: Zone,
  coastal: boolean,
  foreign: Country[],
  seats: number,
  hindiBelt: boolean,
  borders: RegionCode[],
  ref: [number, number],
  pos: [number, number],
  gate?: { name: string; tier: 5 | 6 | 7 },
): Region => ({ code, name, zone, coastal, foreign, seats, hindiBelt, borders, ref, pos, gate });

export const REGIONS: Record<RegionCode, Region> = {
  AP: R('AP', 'Andhra Pradesh', 'South', true, [], 25, false, ['CG', 'KA', 'OD', 'TG', 'TN'], [15.9, 79.7], [282, 624]),
  AR: R('AR', 'Arunachal Pradesh', 'Northeast', false, ['China', 'Bhutan', 'Myanmar'], 2, false, ['AS', 'NL'], [28.0, 94.3], [700, 262]),
  AS: R('AS', 'Assam', 'Northeast', false, ['Bhutan', 'Bangladesh'], 14, false, ['AR', 'ML', 'MN', 'MZ', 'NL', 'TR', 'WB'], [26.2, 92.6], [640, 322]),
  BR: R('BR', 'Bihar', 'East', false, ['Nepal'], 40, true, ['JH', 'UP', 'WB'], [25.6, 85.6], [453, 343], { name: 'Raxaul (to Nepal)', tier: 5 }),
  CG: R('CG', 'Chhattisgarh', 'Central', false, [], 11, true, ['AP', 'JH', 'MH', 'MP', 'OD', 'TG', 'UP'], [21.3, 82.0], [349, 467]),
  DL: R('DL', 'Delhi', 'North', false, [], 7, true, ['HR', 'UP'], [28.6, 77.1], [214, 268], { name: 'IGI Airport', tier: 5 }),
  GA: R('GA', 'Goa', 'West', true, [], 2, false, ['KA', 'MH'], [15.4, 74.0], [117, 638]),
  GJ: R('GJ', 'Gujarat', 'West', true, ['Pakistan'], 26, false, ['MH', 'MP', 'RJ'], [22.7, 71.6], [56, 427]),
  HR: R('HR', 'Haryana', 'North', false, [], 10, true, ['DL', 'HP', 'PB', 'RJ', 'UP'], [29.1, 76.1], [170, 236]),
  HP: R('HP', 'Himachal Pradesh', 'North', false, ['China'], 4, true, ['HR', 'JK', 'LA', 'PB', 'UK'], [31.9, 77.2], [210, 160]),
  JK: R('JK', 'Jammu & Kashmir', 'North', false, ['Pakistan'], 5, false, ['HP', 'LA', 'PB'], [33.5, 75.0], [146, 114]),
  JH: R('JH', 'Jharkhand', 'East', false, [], 14, true, ['BR', 'CG', 'OD', 'UP', 'WB'], [23.6, 85.3], [445, 401]),
  KA: R('KA', 'Karnataka', 'South', true, [], 28, false, ['AP', 'GA', 'KL', 'MH', 'TG', 'TN'], [15.0, 76.0], [175, 650]),
  KL: R('KL', 'Kerala', 'South', true, [], 20, false, ['KA', 'TN'], [10.5, 76.3], [184, 780], { name: 'Kochi', tier: 5 }),
  LA: R('LA', 'Ladakh', 'North', false, ['China', 'Pakistan'], 1, false, ['HP', 'JK'], [34.2, 77.5], [220, 92]),
  MP: R('MP', 'Madhya Pradesh', 'Central', false, [], 29, true, ['CG', 'GJ', 'MH', 'RJ', 'UP'], [23.5, 78.5], [248, 404]),
  MH: R('MH', 'Maharashtra', 'West', true, [], 48, false, ['CG', 'GA', 'GJ', 'KA', 'MP', 'TG'], [19.5, 76.0], [175, 520], { name: 'Mumbai', tier: 5 }),
  MN: R('MN', 'Manipur', 'Northeast', false, ['Myanmar'], 2, false, ['AS', 'MZ', 'NL'], [24.7, 93.9], [690, 384], { name: 'Moreh (to Myanmar)', tier: 6 }),
  ML: R('ML', 'Meghalaya', 'Northeast', false, ['Bangladesh'], 2, false, ['AS'], [25.5, 91.3], [580, 344]),
  MZ: R('MZ', 'Mizoram', 'Northeast', false, ['Myanmar', 'Bangladesh'], 1, false, ['AS', 'MN', 'TR'], [23.4, 92.8], [636, 418]),
  NL: R('NL', 'Nagaland', 'Northeast', false, ['Myanmar'], 1, false, ['AR', 'AS', 'MN'], [26.1, 94.5], [712, 326]),
  OD: R('OD', 'Odisha', 'East', true, [], 21, false, ['AP', 'CG', 'JH', 'WB'], [20.5, 84.4], [419, 490]),
  PB: R('PB', 'Punjab', 'North', false, ['Pakistan'], 13, false, ['HP', 'HR', 'JK', 'RJ'], [30.9, 75.4], [150, 184]),
  RJ: R('RJ', 'Rajasthan', 'North', false, ['Pakistan'], 25, true, ['GJ', 'HR', 'MP', 'PB', 'UP'], [26.6, 73.8], [111, 314]),
  SK: R('SK', 'Sikkim', 'Northeast', false, ['China', 'Nepal', 'Bhutan'], 1, false, ['WB'], [27.5, 88.5], [530, 282]),
  TN: R('TN', 'Tamil Nadu', 'South', true, [], 39, false, ['AP', 'KA', 'KL'], [11.1, 78.4], [245, 763], { name: 'Chennai', tier: 7 }),
  TG: R('TG', 'Telangana', 'South', false, [], 17, false, ['AP', 'CG', 'KA', 'MH'], [17.9, 79.0], [262, 566]),
  TR: R('TR', 'Tripura', 'Northeast', false, ['Bangladesh'], 2, false, ['AS', 'MZ'], [23.8, 91.6], [582, 404]),
  UP: R('UP', 'Uttar Pradesh', 'Central', false, ['Nepal'], 80, true, ['BR', 'CG', 'DL', 'HR', 'JH', 'MP', 'RJ', 'UK'], [27.0, 80.5], [306, 302]),
  UK: R('UK', 'Uttarakhand', 'Central', false, ['China', 'Nepal'], 5, true, ['HP', 'UP'], [30.1, 79.2], [268, 212]),
  WB: R('WB', 'West Bengal', 'East', true, ['Bangladesh', 'Nepal', 'Bhutan'], 42, false, ['AS', 'BR', 'JH', 'OD', 'SK'], [23.8, 87.9], [520, 395], { name: 'Kolkata / Petrapole', tier: 5 }),
};

/** Border lines that bend around a node that would otherwise sit in their way. Key = sorted pair. */
export const BORDER_BENDS: Record<string, [number, number][]> = {
  'HR-UP': [[236, 222]],
  'AS-WB': [[565, 290]],
};

export function isRegionCode(x: unknown): x is RegionCode {
  return typeof x === 'string' && (REGION_CODES as readonly string[]).includes(x);
}

/** Exit gates in play for a given exit-gate setting. */
export function gatesFor(setting: 5 | 6 | 7): RegionCode[] {
  return REGION_CODES.filter((c) => {
    const g = REGIONS[c].gate;
    return g !== undefined && g.tier <= setting;
  });
}

/** Every border once, as [a, b] with a < b. */
export const BORDER_PAIRS: [RegionCode, RegionCode][] = (() => {
  const out: [RegionCode, RegionCode][] = [];
  for (const a of REGION_CODES) {
    for (const b of REGIONS[a].borders) if (a < b) out.push([a, b]);
  }
  return out;
})();
