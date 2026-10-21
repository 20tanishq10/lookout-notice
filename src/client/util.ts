import { useEffect, useState } from 'react';
import { AGENCIES } from '../shared/agencies';
import type { GameView, Phase, PlayerId } from '../shared/types';
import { useStore } from './net';

export const PHASE_LABEL: Record<Phase, string> = {
  night: 'Night',
  deploy: 'Deploy',
  briefing: 'Briefing',
  press: 'Press Release',
  talk: 'Thana Talk',
  action: 'Action',
  inquiry: 'Inquiry',
  report: 'Commission Report',
};

export const PHASE_HINT: Record<Phase, string> = {
  night: 'Mantri ji moves Bhagodalal in the dark.',
  deploy: 'Move your jeep up to 2 borders.',
  briefing: 'Your intel is on its way.',
  press: 'Post your clue: the truth, a lie, or no comment.',
  talk: 'Talk it out on your call. DM people privately.',
  action: 'Propose and sign warrants. Vote on circulars.',
  inquiry: 'Who is Mantri ji? Cast your vote.',
  report: 'Everything is revealed.',
};

/** Re-render every `ms` milliseconds. */
export function useTick(ms = 250): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return t;
}

/** Seconds left in the current phase, synced to the server clock. */
export function useSecondsLeft(g: GameView): number {
  const offset = useStore((s) => s.offset);
  const now = useTick(250);
  if (g.paused) return Math.ceil(g.pausedRemaining / 1000);
  if (!g.phaseEndsAt) return 0;
  return Math.max(0, Math.ceil((g.phaseEndsAt - (now + offset)) / 1000));
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function nameOf(g: GameView, id: PlayerId): string {
  return g.players.find((p) => p.id === id)?.name ?? 'Someone';
}

/** "Riya · CBI", or just "Riya" when the agency is hidden. */
export function labelOf(g: GameView, id: PlayerId): string {
  const p = g.players.find((x) => x.id === id);
  if (!p) return 'Someone';
  return p.agency ? `${p.name} · ${AGENCIES[p.agency].short}` : p.name;
}

export function colourOf(g: GameView, id: PlayerId): string {
  return g.players.find((p) => p.id === id)?.colour ?? '#999';
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
