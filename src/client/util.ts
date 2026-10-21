import { useEffect, useState } from 'react';
import { AGENCIES } from '../shared/agencies';
import type { GameView, Phase, PlayerId } from '../shared/types';
import { useStore } from './net';

/** A round has 4 steps: Night, Move, Report & discuss (post, then talk), Act. */
export const PHASE_LABEL: Record<Phase, string> = {
  night: 'Night',
  deploy: 'Move',
  briefing: 'Move',
  press: 'Report & discuss',
  talk: 'Report & discuss',
  action: 'Act',
  inquiry: 'Inquiry',
  report: 'Commission Report',
};

export const PHASE_ICON: Record<Phase, string> = {
  night: '🌙', deploy: '🚙', briefing: '🚙', press: '📰', talk: '🗣', action: '⚖', inquiry: '🏛', report: '📜',
};

/** Step number within a round (0 = not part of the round loop). */
export const PHASE_STEP: Record<Phase, number> = {
  night: 1, deploy: 2, briefing: 2, press: 3, talk: 3, action: 4, inquiry: 0, report: 0,
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
