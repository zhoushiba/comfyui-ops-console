/** 轻量 Toast：成功/失败/提示，自动消失，最多同时显示 4 条 */
import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, title: string, description?: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (kind, title, description) => {
    const id = (seq += 1);
    set((state) => ({ items: [...state.items.slice(-3), { id, kind, title, description }] }));
    setTimeout(() => {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    }, kind === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

/** 组件外也可调用（如 Mutation 的 onError） */
export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push('success', title, description),
  error: (title: string, description?: string) => useToastStore.getState().push('error', title, description),
  info: (title: string, description?: string) => useToastStore.getState().push('info', title, description),
};
