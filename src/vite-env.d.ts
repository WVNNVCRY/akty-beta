/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' — работать с бэкендом (NestJS + PostgreSQL) вместо локальных демо-данных */
  readonly VITE_API?: string;
  /** Адрес API, если фронтенд и бэкенд на разных доменах (по умолчанию — тот же домен, /api) */
  readonly VITE_API_URL?: string;
  /** '0' — скрыть кнопки быстрого входа демо-пользователей */
  readonly VITE_DEMO_LOGINS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
