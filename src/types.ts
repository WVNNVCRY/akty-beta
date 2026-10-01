export type Role = 'GC' | 'MANAGER' | 'CONTRACTOR' | 'CLIENT';

export const ROLE_LABEL: Record<Role, string> = {
  GC: 'Генподрядчик',
  MANAGER: 'Менеджер',
  CONTRACTOR: 'Подрядчик',
  CLIENT: 'Заказчик',
};

export interface User {
  id: string;
  login: string;
  password: string;
  name: string;
  role: Role;
  contractorId?: string | null;
  clientId?: string | null;
  telegramChatId?: string | null;
  telegramToken?: string | null;
  passwordChangedAt: string;
  active: boolean;
}

export interface Contractor {
  id: string;
  name: string;
  specialization: string; // Механика / Ручка / ...
}

export interface Client {
  id: string;
  name: string;
}

export interface MarkingType {
  id: string;
  code: string; // по ГОСТ Р 51256 / 52289
  name: string;
  widthM: number; // ширина линии, м
  fillRatio: number; // доля заполнения (для прерывистых)
}

export interface SiteObject {
  id: string;
  excelRowNumber: number; // № п/п из таблицы, уникальный
  name: string;
  address: string;
  district: string;
  clientId: string;
  titleM2: number; // общий объём объекта, м²
  createdAt: string;
}

export interface TitleChange {
  from: number;
  to: number;
  at: string;
  userId: string;
  reason: string;
}

export interface Execution {
  id: string;
  objectId: string;
  number: number;
  name: string;
  periodFrom: string;
  periodTo: string;
  titleM2: number; // общий титульный объём, без разбивки по видам разметки
  contractorIds: string[];
  lastActivityAt: string;
  reminderLevel: number; // 0 — нет, 1 — первое, 2 — второе
  history: HistoryEntry[]; // журнал выполнения (титул, редактирование)
  titleChange?: TitleChange | null; // последнее изменение титула в ходе согласования
}

export type FormStatus =
  | 'DRAFT'
  | 'WAITING_PARTNER'
  | 'ON_CHECK_CLIENT'
  | 'APPROVED_BY_CLIENT'
  | 'REJECTED_BY_CLIENT'
  | 'REJECTED_BY_GC'
  | 'TITLE_CHANGED';

export const FORM_STATUS: Record<FormStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Черновик', color: 'default' },
  WAITING_PARTNER: { label: 'Ожидание партнёра', color: 'gold' },
  ON_CHECK_CLIENT: { label: 'На проверке заказчика', color: 'blue' },
  APPROVED_BY_CLIENT: { label: 'Одобрена заказчиком', color: 'green' },
  REJECTED_BY_CLIENT: { label: 'Отклонена заказчиком', color: 'red' },
  REJECTED_BY_GC: { label: 'Возвращена ГП', color: 'volcano' },
  TITLE_CHANGED: { label: 'Изменён титул, требуется пересчёт', color: 'magenta' },
};

/** Как статус формы видит заказчик (внутренние статусы скрыты). */
export function clientFormStatus(s: FormStatus): { label: string; color: string } {
  if (s === 'ON_CHECK_CLIENT') return { label: 'Ждёт вашего решения', color: 'blue' };
  if (s === 'APPROVED_BY_CLIENT') return { label: 'Одобрена вами', color: 'green' };
  if (s === 'REJECTED_BY_CLIENT') return { label: 'Отклонена вами', color: 'red' };
  if (s === 'TITLE_CHANGED') return { label: 'Изменён титул, требуется пересчёт', color: 'magenta' };
  return { label: 'На доработке у подрядчика', color: 'orange' };
}

export interface FileRef {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface FormLine {
  markingTypeId: string;
  linearM: number;
  /** Зафиксированная площадь (API-режим, только согласованные/архивные акты): не меняется при смене коэффициентов. */
  m2?: number;
}

export interface HistoryEntry {
  at: string;
  userId: string;
  action: string;
  comment?: string;
  hiddenFromClient?: boolean; // комментарии ГП заказчику не показываются
  highlight?: boolean; // важное событие (например, изменение титула)
}

export interface ContractorForm {
  id: string;
  executionId: string;
  contractorId: string;
  lines: FormLine[];
  schemeFile?: FileRef | null;
  photoFile?: FileRef | null;
  status: FormStatus;
  autoZero?: boolean; // отправлена автоматически с нулевым объёмом
  updatedAt: string;
  history: HistoryEntry[];
}

export type ActStatus = 'ON_CHECK_CLIENT' | 'IN_REVISION' | 'ON_CHECK_GC' | 'APPROVED' | 'ARCHIVED';

export const ACT_STATUS: Record<ActStatus, { label: string; color: string }> = {
  ON_CHECK_CLIENT: { label: 'На проверке заказчика', color: 'blue' },
  IN_REVISION: { label: 'На доработке', color: 'orange' },
  ON_CHECK_GC: { label: 'На проверке ГП', color: 'geekblue' },
  APPROVED: { label: 'Согласован', color: 'green' },
  ARCHIVED: { label: 'В архиве', color: 'purple' },
};

export interface ActRow {
  contractorId: string;
  lines: FormLine[];
  schemeFile?: FileRef | null;
  photoFile?: FileRef | null;
  autoZero?: boolean;
}

export interface Act {
  id: string;
  number: string;
  executionId: string;
  objectId: string;
  status: ActStatus;
  round: number;
  createdAt: string;
  updatedAt: string;
  rows: ActRow[];
  history: HistoryEntry[];
  wordDownloadedAt?: string | null;
  archivedAt?: string | null;
}

export interface ChatMessage {
  id: string;
  objectId: string;
  userId: string;
  text: string;
  at: string;
}

export type NotificationKind = 'action' | 'important' | 'reminder' | 'info';

export const NOTIFICATION_KIND: Record<NotificationKind, { label: string; color: string }> = {
  action: { label: 'Требует действия', color: 'blue' },
  important: { label: 'Важное', color: 'magenta' },
  reminder: { label: 'Напоминание', color: 'orange' },
  info: { label: 'Информация', color: 'default' },
};

export interface Notification {
  id: string;
  userId: string;
  text: string;
  at: string;
  read: boolean;
  link?: string;
  telegram: boolean;
  kind: NotificationKind;
  objectId?: string | null; // для группировки
  executionId?: string | null;
}

export interface Settings {
  remindFirstDays: number;
  remindSecondDays: number;
  toleranceM2: number;
}

export interface Data {
  users: User[];
  contractors: Contractor[];
  clients: Client[];
  markingTypes: MarkingType[];
  objects: SiteObject[];
  executions: Execution[];
  forms: ContractorForm[];
  acts: Act[];
  chat: ChatMessage[];
  notifications: Notification[];
  settings: Settings;
  clockOffsetDays: number;
  actCounter: number;
}
