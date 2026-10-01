// Единая точка изменения данных для UI.
// Демо-режим — бизнес-логика в браузере (engine.ts), API-режим — запросы к бэкенду,
// где те же правила выполняются в транзакциях PostgreSQL, затем снимок перечитывается.
import type { Act, Data, FileRef, FormLine, Settings } from './types';
import { API_MODE, api, apiBlob, token } from './api';
import { useStore } from './store';
import {
  archiveAct, checkReminders, clientApproveForm, clientRejectForm, correctAct, deleteExecution, deleteObject, downloadWordLog,
  gcApproveAct, gcReturnAct, saveExecution, saveForm, saveObject, sendChat, submitForm, withdrawForm,
  type ExecutionPatch, type ObjectPatch,
} from './engine';
import { downloadBlob, makeEmptyDocx } from './files';

type Msg = { message: string; id?: string };

const run = <T>(fn: (d: Data, userId: string) => T): T => useStore.getState().run(fn);
const refresh = () => useStore.getState().refresh();

/** API-вызов + перечитать данные. */
async function call<T = Msg>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(method, path, body);
  } finally {
    await refresh().catch(() => undefined);
  }
}

export type AdminColl = 'users' | 'contractors' | 'clients' | 'markingTypes';
const adminPath: Record<AdminColl, string> = { users: 'users', contractors: 'contractors', clients: 'clients', markingTypes: 'marking-types' };

export const actions = {
  // ---------- Формы подрядчика ----------
  async saveForm(exId: string, p: { lines: FormLine[]; schemeFile: FileRef | null; photoFile: FileRef | null }, submit: boolean): Promise<string> {
    if (!API_MODE) {
      return run((d, u) => {
        const f = saveForm(d, u, exId, p);
        return submit ? submitForm(d, u, f.id) : 'Черновик сохранён';
      });
    }
    const r = await call<Msg>('POST', `/executions/${exId}/form`, {
      lines: p.lines, schemeFileId: p.schemeFile?.id ?? null, photoFileId: p.photoFile?.id ?? null, submit,
    });
    return r.message;
  },
  async withdrawForm(formId: string) {
    if (!API_MODE) return run((d, u) => withdrawForm(d, u, formId));
    await call('POST', `/forms/${formId}/withdraw`);
  },
  async clientApproveForm(formId: string) {
    if (!API_MODE) return run((d, u) => clientApproveForm(d, u, formId));
    await call('POST', `/forms/${formId}/approve`);
  },
  async clientRejectForm(formId: string, comment: string) {
    if (!API_MODE) return run((d, u) => clientRejectForm(d, u, formId, comment));
    await call('POST', `/forms/${formId}/reject`, { comment });
  },

  // ---------- Акты ----------
  async gcApproveAct(actId: string) {
    if (!API_MODE) return run((d, u) => gcApproveAct(d, u, actId));
    await call('POST', `/acts/${actId}/approve`);
  },
  async gcReturnAct(actId: string, contractorIds: string[], comment: string) {
    if (!API_MODE) return run((d, u) => gcReturnAct(d, u, actId, contractorIds, comment));
    await call('POST', `/acts/${actId}/return`, { contractorIds, comment });
  },
  async archiveActs(actIds: string[]) {
    if (!API_MODE) return run((d, u) => actIds.forEach((id) => archiveAct(d, u, id)));
    await call('POST', '/acts/archive', { actIds });
  },
  async correctAct(actId: string, rows: { contractorId: string; lines: FormLine[] }[], reason: string) {
    if (!API_MODE) return run((d, u) => correctAct(d, u, actId, rows, reason));
    await call('POST', `/acts/${actId}/correct`, { rows, reason });
  },
  /** Word: в API-режиме сервер формирует файл, сохраняет в хранилище и пишет в журнал. */
  async downloadWord(data: Data, act: Act) {
    const obj = data.objects.find((o) => o.id === act.objectId);
    const fallback = `${act.number}_№${obj?.excelRowNumber ?? ''}.docx`;
    if (!API_MODE) {
      run((d, u) => downloadWordLog(d, u, act.id));
      await downloadBlob(await makeEmptyDocx(), fallback);
      return;
    }
    try {
      const { blob } = await apiBlob('POST', `/acts/${act.id}/word`);
      await downloadBlob(blob, fallback);
    } finally {
      await refresh().catch(() => undefined);
    }
  },

  // ---------- Объекты и выполнения ----------
  async saveObject(objectId: string | null, p: ObjectPatch): Promise<string> {
    if (!API_MODE) return run((d, u) => saveObject(d, u, objectId, p));
    const r = await call<Msg>(objectId ? 'PUT' : 'POST', objectId ? `/objects/${objectId}` : '/objects', p);
    return r.id!;
  },
  async deleteObject(objectId: string) {
    if (!API_MODE) return run((d, u) => deleteObject(d, u, objectId));
    await call('DELETE', `/objects/${objectId}`);
  },
  async saveExecution(objectId: string, exId: string | null, p: ExecutionPatch, reason: string) {
    if (!API_MODE) return run((d, u) => saveExecution(d, u, objectId, exId, p, reason));
    await call(exId ? 'PUT' : 'POST', exId ? `/executions/${exId}` : `/objects/${objectId}/executions`, { ...p, reason });
  },
  async deleteExecution(exId: string) {
    if (!API_MODE) return run((d, u) => deleteExecution(d, u, exId));
    await call('DELETE', `/executions/${exId}`);
  },

  // ---------- Чат, уведомления ----------
  async sendChat(objectId: string, text: string) {
    if (!text.trim()) return;
    if (!API_MODE) return run((d, u) => sendChat(d, u, objectId, text));
    await call('POST', `/objects/${objectId}/chat`, { text });
  },
  async markRead(ids: string[]) {
    if (!ids.length) return;
    if (!API_MODE) {
      return run((d) => {
        const set = new Set(ids);
        d.notifications.forEach((n) => { if (set.has(n.id)) n.read = true; });
      });
    }
    // Оптимистично отмечаем сразу, чтобы бейдж не «мигал»
    const set = new Set(ids);
    useStore.setState((s) => ({ notifications: s.notifications.map((n) => (set.has(n.id) ? { ...n, read: true } : n)) }));
    await call('POST', '/notifications/read', { ids });
  },

  // ---------- Админка (только ГП) ----------
  /** local — логика демо-режима (валидация и запись в локальные данные). */
  async adminSave(coll: AdminColl, id: string | null, values: any, local: (d: Data) => void) {
    if (!API_MODE) return run((d) => local(d));
    await call(id ? 'PUT' : 'POST', `/admin/${adminPath[coll]}${id ? `/${id}` : ''}`, values);
  },
  async adminDelete(coll: AdminColl, id: string, local: (d: Data) => void) {
    if (!API_MODE) return run((d) => local(d));
    await call('DELETE', `/admin/${adminPath[coll]}/${id}`);
  },
  async saveSettings(v: Settings) {
    if (!API_MODE) return run((d) => { d.settings = { ...d.settings, ...v }; });
    await call('PUT', '/admin/settings', v);
  },
  // ---------- Личный кабинет ----------
  async telegramCode(): Promise<{ code: string; botEnabled: boolean }> {
    if (!API_MODE) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      run((d, u) => { d.users.find((x) => x.id === u)!.telegramToken = code; });
      return { code, botEnabled: false };
    }
    return api('POST', '/me/telegram-code');
  },
  async telegramUnlink() {
    if (!API_MODE) return run((d, u) => { const x = d.users.find((y) => y.id === u)!; x.telegramChatId = null; x.telegramToken = null; });
    await call('POST', '/me/telegram-unlink');
  },
  async changePassword(oldPassword: string, newPassword: string) {
    if (!API_MODE) {
      return run((d, u) => {
        const x = d.users.find((y) => y.id === u)!;
        if (x.password !== oldPassword) throw new Error('Текущий пароль указан неверно');
        x.password = newPassword;
        x.passwordChangedAt = new Date().toISOString();
      });
    }
    const r = await api<{ token: string }>('POST', '/auth/password', { oldPassword, newPassword });
    token.set(r.token); // старые сессии на других устройствах завершены, текущая продолжает работать
  },

  async runReminders(): Promise<string> {
    if (!API_MODE) { run((d) => checkReminders(d)); return 'Напоминания проверены'; }
    return (await call<Msg>('POST', '/admin/reminders/run')).message;
  },
};
