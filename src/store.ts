import { create, type StateCreator } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Data, User } from './types';
import { buildSeed } from './seed';
import { checkReminders } from './engine';
import { API_MODE, api, setUnauthorizedHandler, token } from './api';

/**
 * Два режима:
 *  • демо (по умолчанию, GitHub Pages) — данные и бизнес-логика в браузере, localStorage;
 *  • API (VITE_API=1) — данные на сервере (NestJS + PostgreSQL), стор хранит снимок,
 *    видимый текущему пользователю, и перечитывает его после каждого действия и раз в 15 с.
 */
interface State extends Data {
  currentUserId: string | null;
  /** API-режим: снимок загружен */
  loaded: boolean;
  /** Демо-режим: выполнить мутацию над копией данных. Бросает ошибку бизнес-логики — UI её показывает. */
  run: <T>(fn: (d: Data, userId: string) => T) => T;
  login: (login: string, password: string) => Promise<boolean>;
  loginAs: (userId: string) => void;
  logout: () => void;
  reset: () => void;
  /** API-режим: перечитать снимок с сервера */
  refresh: () => Promise<void>;
}

const pickData = (s: State): Data => ({
  users: s.users, contractors: s.contractors, clients: s.clients, markingTypes: s.markingTypes,
  objects: s.objects, executions: s.executions, forms: s.forms, acts: s.acts, chat: s.chat,
  notifications: s.notifications, settings: s.settings, clockOffsetDays: s.clockOffsetDays, actCounter: s.actCounter,
});

const emptyData = (): Data => ({
  users: [], contractors: [], clients: [], markingTypes: [], objects: [], executions: [], forms: [], acts: [], chat: [],
  notifications: [], settings: { remindFirstDays: 2, remindSecondDays: 5, toleranceM2: 0 }, clockOffsetDays: 0, actCounter: 0,
});

const USER_KEY = 'akty-user';
let refreshing: Promise<void> | null = null;

const creator: StateCreator<State> = (set, get) => ({
  ...(API_MODE ? emptyData() : buildSeed()),
  currentUserId: API_MODE ? (token.get() ? localStorage.getItem(USER_KEY) : null) : null,
  loaded: !API_MODE,
  run: (fn) => {
    if (API_MODE) throw new Error('run() недоступен в API-режиме');
    const draft = structuredClone(pickData(get()));
    const res = fn(draft, get().currentUserId || '');
    set(draft);
    return res;
  },
  login: async (login, password) => {
    if (!API_MODE) {
      const u = get().users.find((x) => x.login === login.trim() && x.password === password && x.active);
      if (!u) return false;
      set({ currentUserId: u.id });
      return true;
    }
    const r = await api<{ token: string; userId: string }>('POST', '/auth/login', { login: login.trim(), password });
    token.set(r.token);
    localStorage.setItem(USER_KEY, r.userId);
    set({ currentUserId: r.userId, loaded: false });
    await get().refresh();
    return true;
  },
  loginAs: (userId) => set({ currentUserId: userId }),
  logout: () => {
    if (API_MODE) {
      token.clear();
      localStorage.removeItem(USER_KEY);
      set({ ...emptyData(), currentUserId: null, loaded: false });
      return;
    }
    set({ currentUserId: null });
  },
  reset: () => set({ ...buildSeed(), currentUserId: null }),
  refresh: async () => {
    if (!API_MODE || !token.get()) return;
    // Параллельные вызовы схлопываются в один запрос
    refreshing ??= api<Data>('GET', '/state')
      .then((d) => set({ ...pickData(d as State), loaded: true }))
      .finally(() => { refreshing = null; });
    return refreshing;
  },
});

export const useStore = API_MODE
  ? create<State>()(creator)
  : create<State>()(
      persist(creator, {
        name: 'akty-beta-v4', // v4: пустой старт без демо-объектов
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
      }),
    );

if (API_MODE) setUnauthorizedHandler(() => useStore.getState().logout());

export function useMe(): User | null {
  const id = useStore((s) => s.currentUserId);
  const users = useStore((s) => s.users);
  return users.find((u) => u.id === id) || null;
}

export const useData = (): Data => {
  const s = useStore();
  return pickData(s);
};
