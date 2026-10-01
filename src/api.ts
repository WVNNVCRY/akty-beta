// Клиент REST API бэкенда (NestJS). Используется только в режиме VITE_API=1.
export const API_MODE = import.meta.env.VITE_API === '1';
const BASE = (import.meta.env.VITE_API_URL || '') + '/api';
const KEY = 'akty-token';

export const token = {
  get: () => localStorage.getItem(KEY),
  set: (t: string) => localStorage.setItem(KEY, t),
  clear: () => localStorage.removeItem(KEY),
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const t = token.get();
  const isForm = body instanceof FormData;
  let r: Response;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error('Сервер недоступен. Проверьте подключение.');
  }
  if (r.ok) return r;
  let message = `Ошибка ${r.status}`;
  try { message = (await r.json()).message || message; } catch { /* не JSON */ }
  if (r.status === 401 && path !== '/auth/login') {
    token.clear();
    onUnauthorized?.();
  }
  throw new Error(message);
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await request(method, path, body);
  return r.status === 204 ? (undefined as T) : r.json();
}

/** Скачать файл (тело + имя из Content-Disposition). */
export async function apiBlob(method: string, path: string): Promise<{ blob: Blob; name: string | null }> {
  const r = await request(method, path);
  const cd = r.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  return { blob: await r.blob(), name: m ? decodeURIComponent(m[1]) : null };
}
