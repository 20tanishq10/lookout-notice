import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, GameAction, RoomView } from '../shared/types';

export interface Session {
  code: string;
  token: string;
  playerId: string;
}

const SESSION_KEY = 'ln-session';
const NAME_KEY = 'ln-name';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage can be unavailable (private mode); the game still works for this tab */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

interface State {
  view: RoomView | null;
  connected: boolean;
  /** serverNow - Date.now(), so timers agree with the server. */
  offset: number;
  toast: Toast | null;
  /** True while we wait for the host to approve a seat request. */
  claimPending: boolean;
  restoring: boolean;
}

let state: State = { view: null, connected: false, offset: 0, toast: null, claimPending: false, restoring: !!loadSession() };
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state),
  );
}

export function getState(): State {
  return state;
}

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'error'): void {
  const id = ++toastSeq;
  set({ toast: { id, text, kind } });
  setTimeout(() => {
    if (state.toast?.id === id) set({ toast: null });
  }, 3500);
}

export const socket: Socket = io({ transports: ['websocket', 'polling'], autoConnect: true });

export function emit<T = unknown>(event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Reconnecting… try again in a moment.' });
      return;
    }
    socket.timeout(8000).emit(event, payload ?? {}, (e: Error | null, res: Ack<T>) => {
      resolve(e ? { ok: false, error: 'The server did not answer. Check your connection.' } : res);
    });
  });
}

/** Send a game action; shows a toast if the server refuses it. */
export async function act(action: GameAction, quiet = false): Promise<boolean> {
  const res = await emit('game:act', action);
  if (!res.ok && !quiet) toast(res.error);
  return res.ok;
}

export async function hostEmit(event: string, payload?: unknown): Promise<boolean> {
  const res = await emit(event, payload);
  if (!res.ok) toast(res.error);
  return res.ok;
}

async function rejoin(): Promise<void> {
  const s = loadSession();
  if (!s) {
    set({ restoring: false });
    return;
  }
  const res = await emit<Session>('room:rejoin', { code: s.code, token: s.token });
  if (!res.ok) {
    saveSession(null);
    set({ view: null });
  }
  set({ restoring: false });
}

export function enterRoom(data: Session): void {
  saveSession(data);
  set({ claimPending: false });
}

export async function leaveRoom(): Promise<void> {
  await emit('room:leave');
  saveSession(null);
  set({ view: null });
}

socket.on('connect', () => {
  set({ connected: true });
  void rejoin();
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('view', (view: RoomView) => {
  set({ view, offset: view.game ? view.game.serverNow - Date.now() : state.offset });
});
socket.on('kicked', () => {
  saveSession(null);
  set({ view: null });
  toast('The host removed you from the room.', 'info');
});
socket.on('claim:result', (res: Ack<Session>) => {
  set({ claimPending: false });
  if (res.ok && res.data) {
    enterRoom(res.data);
    void rejoin();
  } else toast(res.ok ? 'Something went wrong.' : res.error);
});

export function setClaimPending(v: boolean): void {
  set({ claimPending: v });
}
