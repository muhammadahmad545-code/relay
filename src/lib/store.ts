import { create } from 'zustand';
import RelayTransfer from '../../modules/relay-transfer';
import type { TransferEvent } from '../../modules/relay-transfer';
import * as Clipboard from 'expo-clipboard';
import { addHistory, clearHistory, forgetFile, listHistory } from './history';
import { autoCopySetting } from './settings';
import type { HistoryEntry } from './history';

export interface LiveTransfer extends TransferEvent {
  startedAt: number;
  updatedAt: number;
}

export interface ReceivedText {
  id: string;
  text: string;
  at: number;
}

interface RelayState {
  transfers: Record<string, LiveTransfer>;
  texts: ReceivedText[];
  peers: string[];
  history: HistoryEntry[];
  historyError: string | null;
  loadHistory: () => Promise<void>;
  wipeHistory: () => Promise<void>;
  forgetFile: (id: string) => Promise<void>;
  resetSession: () => void;
}

export const useRelay = create<RelayState>((set) => ({
  transfers: {},
  texts: [],
  peers: [],
  history: [],
  historyError: null,
  loadHistory: async () => {
    try {
      set({ history: await listHistory(), historyError: null });
    } catch {
      set({ historyError: 'History could not be loaded.' });
    }
  },
  forgetFile: async (id) => {
    await forgetFile(id);
    set((state) => ({ history: state.history.map((h) => (h.id === id ? { ...h, savedUri: null } : h)) }));
  },
  wipeHistory: async () => {
    await clearHistory();
    set({ history: [] });
  },
  resetSession: () => set({ transfers: {}, texts: [], peers: [] }),
}));

let subscribed = false;
let textCounter = 0;

/** Wire native events into the store once for the lifetime of the app. */
export function subscribeToRelayEvents(): void {
  if (subscribed) return;
  subscribed = true;

  RelayTransfer.addListener('onTransfer', (event) => {
    const now = Date.now();
    useRelay.setState((state) => {
      const previous = state.transfers[event.id];
      return {
        transfers: { ...state.transfers, [event.id]: { ...event, startedAt: previous?.startedAt ?? now, updatedAt: now } },
      };
    });
    if (event.status !== 'active') {
      const entry: HistoryEntry = {
        id: event.id,
        direction: event.direction,
        name: event.name,
        size: event.size,
        status: event.status,
        error: event.error,
        savedUri: event.savedUri,
        createdAt: now,
      };
      addHistory(entry)
        .then(() => useRelay.getState().loadHistory())
        .catch(() => useRelay.setState({ historyError: 'This transfer could not be saved to history.' }));
    }
  });

  RelayTransfer.addListener('onText', (event) => {
    if (autoCopySetting.get()) Clipboard.setStringAsync(event.text).catch(() => {});
    useRelay.setState((state) => ({
      texts: [{ id: `text-${++textCounter}`, text: event.text, at: Date.now() }, ...state.texts].slice(0, 50),
    }));
  });

  RelayTransfer.addListener('onPeer', (event) => {
    useRelay.setState((state) => (state.peers.includes(event.address) ? state : { peers: [...state.peers, event.address] }));
  });
}
