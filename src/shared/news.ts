export const NEWS_IDS = [
  'BANDH', 'DIWALI', 'MONSOON', 'MCC', 'COURT', 'CCTV', 'FASTAG', 'TRANSFER', 'TIP', 'INTERPOL', 'HAWALA_BUST', 'CALLS',
] as const;
export type NewsId = (typeof NEWS_IDS)[number];

export const NEWS: Record<NewsId, { title: string; text: string }> = {
  BANDH: { title: 'Bharat Bandh', text: 'No jeep may move this round.' },
  DIWALI: { title: 'Diwali Rush', text: "The trains are full, so he can't move tonight unless he has been flushed." },
  MONSOON: { title: 'Monsoon Floods', text: "A coastal region is sealed: no jeep enters or leaves this round, and he can't move into or out of it tonight." },
  MCC: { title: 'Model Code of Conduct', text: 'Polls are on in one region, and no jeep may enter it this round.' },
  COURT: { title: 'Court Stay', text: 'No warrants this round.' },
  CCTV: { title: 'Viral CCTV', text: 'Everyone learns his current zone at Briefing.' },
  FASTAG: { title: 'FASTag Outage', text: "Tonight's move posts no ping." },
  TRANSFER: { title: 'Transfer Season', text: 'Two random agencies swap jeep positions before Deploy.' },
  TIP: { title: 'Anonymous Tip', text: "Everyone learns 3 random regions he isn't in, at Briefing." },
  INTERPOL: { title: 'Interpol Alert', text: 'No escape tonight.' },
  HAWALA_BUST: { title: 'Hawala Bust', text: 'Mantri ji loses one unused Hawala move, if any are left. Nobody learns whether there was one.' },
  CALLS: { title: 'Call Records Leak', text: 'Everyone learns which jeep was closest to him last round.' },
};
