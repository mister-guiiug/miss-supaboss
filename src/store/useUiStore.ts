import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface UiState {
  toasts: Toast[];
  push: (kind: Toast['kind'], message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useUiStore = create<UiState>(set => ({
  toasts: [],
  push: (kind, message) => {
    seq += 1;
    const id = seq;
    set(s => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
    }, 5000);
  },
  dismiss: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export const toast = {
  success: (message: string) => useUiStore.getState().push('success', message),
  error: (message: string) => useUiStore.getState().push('error', message),
  info: (message: string) => useUiStore.getState().push('info', message),
};
