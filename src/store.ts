import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Data, User } from './types';
import { buildSeed } from './seed';
import { checkReminders } from './engine';

interface State extends Data {
  currentUserId: string | null;
  /** Выполнить мутацию над копией данных. Бросает ошибку бизнес-логики — UI её показывает. */
  run: <T>(fn: (d: Data, userId: string) => T) => T;
  login: (login: string, password: string) => boolean;
  loginAs: (userId: string) => void;
  logout: () => void;
  reset: () => void;
}

const pickData = (s: State): Data => ({
  users: s.users, contractors: s.contractors, clients: s.clients, markingTypes: s.markingTypes,
  objects: s.objects, executions: s.executions, forms: s.forms, acts: s.acts, chat: s.chat,
  notifications: s.notifications, settings: s.settings, clockOffsetDays: s.clockOffsetDays, actCounter: s.actCounter,
});

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...buildSeed(),
      currentUserId: null,
      run: (fn) => {
        const draft = structuredClone(pickData(get()));
        const res = fn(draft, get().currentUserId || '');
        set(draft);
        return res;
      },
      login: (login, password) => {
        const u = get().users.find((x) => x.login === login.trim() && x.password === password && x.active);
        if (!u) return false;
        set({ currentUserId: u.id });
        return true;
      },
      loginAs: (userId) => set({ currentUserId: userId }),
      logout: () => set({ currentUserId: null }),
      reset: () => set({ ...buildSeed(), currentUserId: get().currentUserId ? null : null }),
    }),
    {
      name: 'akty-beta-v3',
      version: 1,
      onRehydrateStorage: () => (state) => {
        // «Cron»: при загрузке проверяем напоминания
        setTimeout(() => {
          try {
            useStore.getState().run((d) => checkReminders(d));
          } catch { /* noop */ }
        }, 0);
        return state;
      },
    },
  ),
);

export function useMe(): User | null {
  const id = useStore((s) => s.currentUserId);
  const users = useStore((s) => s.users);
  return users.find((u) => u.id === id) || null;
}

export const useData = (): Data => {
  const s = useStore();
  return pickData(s);
};
