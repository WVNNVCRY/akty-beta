// Бизнес-логика согласования. Все функции мутируют переданный черновик Data.
// Поток: подрядчики → (сумма = титул) → заказчик (по формам) → ГП (акт целиком) → архив.
import type { Act, ContractorForm, Data, Execution, FileRef, FormLine, HistoryEntry, NotificationKind, User } from './types';
import {
  COUNTED, DAY, EDITABLE, actLocked, actOf, executionBalance, fmt, formTotalM2, isComplete, isStaff, round2, shortage,
} from './logic';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const nowMs = (d: Data) => Date.now() + d.clockOffsetDays * DAY;
export const nowIso = (d: Data) => new Date(nowMs(d)).toISOString();

class BizError extends Error {}
const fail = (m: string): never => {
  throw new BizError(m);
};

function actor(d: Data, userId: string): User {
  const u = d.users.find((x) => x.id === userId);
  if (!u) fail('Пользователь не найден');
  return u!;
}

const staffIds = (d: Data) => d.users.filter((u) => u.active && isStaff(u.role)).map((u) => u.id);
const contractorUserIds = (d: Data, contractorIds: string[]) =>
  d.users.filter((u) => u.active && u.role === 'CONTRACTOR' && contractorIds.includes(u.contractorId || '')).map((u) => u.id);
const clientUserIds = (d: Data, clientId: string) =>
  d.users.filter((u) => u.active && u.role === 'CLIENT' && u.clientId === clientId).map((u) => u.id);

export function notify(
  d: Data, userIds: string[], text: string, link?: string,
  meta: { kind: NotificationKind; ex?: Execution | null } = { kind: 'info' },
) {
  const at = nowIso(d);
  [...new Set(userIds)].forEach((userId) => {
    const u = d.users.find((x) => x.id === userId);
    d.notifications.unshift({
      id: uid(), userId, text, at, read: false, link,
      telegram: !!u?.telegramChatId && u.role !== 'CLIENT', // заказчик в Telegram — позже
      kind: meta.kind, objectId: meta.ex?.objectId || null, executionId: meta.ex?.id || null,
    });
  });
}

function exCtx(d: Data, exId: string) {
  const ex = (d.executions.find((e) => e.id === exId) || fail('Выполнение не найдено')) as Execution;
  const obj = d.objects.find((o) => o.id === ex.objectId)!;
  return { ex, obj, label: `«${obj.name}», ${ex.name}`, link: `/objects/${obj.id}?ex=${ex.id}` };
}

function touch(d: Data, ex: Execution) {
  ex.lastActivityAt = nowIso(d);
  ex.reminderLevel = 0;
}

const h = (d: Data, userId: string, action: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  at: nowIso(d), userId, action, ...extra,
});

export const contractorName = (d: Data, id: string) => d.contractors.find((c) => c.id === id)?.name || '—';

/** Обновить снимок строк акта из текущих форм (пока акт не у ГП). */
function syncActRows(d: Data, act: Act) {
  const ex = d.executions.find((e) => e.id === act.executionId)!;
  act.rows = ex.contractorIds.map((cid) => {
    const f = d.forms.find((x) => x.executionId === ex.id && x.contractorId === cid);
    return {
      contractorId: cid, lines: structuredClone(f?.lines || []), schemeFile: f?.schemeFile || null,
      photoFile: f?.photoFile || null, autoZero: !!f?.autoZero,
    };
  });
}

function setActStatus(d: Data, act: Act, status: Act['status'], userId: string, action: string, extra: Partial<HistoryEntry> = {}) {
  act.status = status;
  act.updatedAt = nowIso(d);
  act.history.push(h(d, userId, action, extra));
}

/** Перевести акт на доработку (если он был у заказчика). */
function actToRevision(d: Data, exId: string, userId: string, action: string, extra: Partial<HistoryEntry> = {}) {
  const act = actOf(d, exId);
  if (act && act.status === 'ON_CHECK_CLIENT') setActStatus(d, act, 'IN_REVISION', userId, action, extra);
  if (act) syncActRows(d, act);
}

// ---------------- Формы подрядчика ----------------

export function saveForm(
  d: Data, userId: string, exId: string,
  patch: { lines: FormLine[]; schemeFile?: FileRef | null; photoFile?: FileRef | null },
): ContractorForm {
  const u = actor(d, userId);
  if (u.role !== 'CONTRACTOR' || !u.contractorId) fail('Заполнять форму может только подрядчик');
  const { ex } = exCtx(d, exId);
  if (!ex.contractorIds.includes(u.contractorId!)) fail('Вы не назначены на это выполнение');
  if (actLocked(actOf(d, exId))) fail('Акт уже у генподрядчика или согласован — редактирование недоступно');
  let f = d.forms.find((x) => x.executionId === exId && x.contractorId === u.contractorId);
  if (f && !EDITABLE.includes(f.status)) fail('Форма подана. Чтобы изменить её, сначала отзовите.');
  // объединяем дубли, отбрасываем пустые строки
  const map = new Map<string, number>();
  patch.lines.forEach((l) => {
    if (!l.markingTypeId || !d.markingTypes.some((m) => m.id === l.markingTypeId)) return;
    map.set(l.markingTypeId, round2((map.get(l.markingTypeId) || 0) + Math.max(0, Number(l.linearM) || 0)));
  });
  const lines = [...map.entries()].map(([markingTypeId, linearM]) => ({ markingTypeId, linearM }));
  if (!f) {
    f = {
      id: uid(), executionId: exId, contractorId: u.contractorId!, lines, status: 'DRAFT',
      schemeFile: null, photoFile: null, updatedAt: nowIso(d), history: [h(d, userId, 'Форма создана')],
    };
    d.forms.push(f);
  }
  f.lines = lines;
  f.autoZero = false;
  if (patch.schemeFile !== undefined) f.schemeFile = patch.schemeFile;
  if (patch.photoFile !== undefined) f.photoFile = patch.photoFile;
  f.updatedAt = nowIso(d);
  return f;
}

export function submitForm(d: Data, userId: string, formId: string): string {
  const u = actor(d, userId);
  const form = (d.forms.find((x) => x.id === formId) || fail('Форма не найдена')) as ContractorForm;
  if (u.contractorId !== form.contractorId) fail('Это не ваша форма');
  if (!EDITABLE.includes(form.status)) fail('Форма уже подана');
  const { ex, label, link } = exCtx(d, form.executionId);
  if (actLocked(actOf(d, ex.id))) fail('Акт уже у генподрядчика или согласован');
  if (!form.lines.some((l) => l.linearM > 0)) fail('Не введён ни один объём');
  if (!form.schemeFile) fail('Не загружена PDF-схема');
  if (!form.photoFile) fail('Не загружено PDF-фото');
  const bal = executionBalance(d, ex, { ...form, status: 'WAITING_PARTNER' });
  if (bal.diff > d.settings.toleranceM2 + 1e-9) {
    fail(`Превышение титула на ${fmt(bal.diff)} м² (титул ${fmt(bal.title)} м², с вашей формой ${fmt(bal.submitted)} м²). Уменьшите объём.`);
  }
  form.status = 'WAITING_PARTNER';
  form.autoZero = false;
  form.updatedAt = nowIso(d);
  form.history.push(h(d, userId, `Форма подана: ${fmt(formTotalM2(d, form))} м²`));
  touch(d, ex);
  if (advance(d, ex, userId)) {
    return 'Объёмы сошлись с титулом — формы отправлены заказчику.';
  }
  const partners = ex.contractorIds.filter((c) => c !== form.contractorId);
  notify(d, contractorUserIds(d, partners),
    `${contractorName(d, form.contractorId)} подал форму (${label}). Недостача до титула: ${fmt(shortage(bal))} м²`, link, { kind: 'action', ex });
  return `Форма принята, статус «Ожидание партнёра». Недостача до титула: ${fmt(shortage(bal))} м².`;
}

/**
 * Если сумма поданных форм = титулу: остальные подрядчики получают автоформы с нулями,
 * все ожидающие формы уходят заказчику, акт создаётся / возвращается к заказчику.
 */
function advance(d: Data, ex: Execution, userId: string): boolean {
  const bal = executionBalance(d, ex);
  if (!isComplete(d, bal)) return false;
  const { obj, label, link } = exCtx(d, ex.id);

  // Автоотправка нулевых форм
  ex.contractorIds.forEach((cid) => {
    let f = d.forms.find((x) => x.executionId === ex.id && x.contractorId === cid);
    if (f && COUNTED.includes(f.status)) return;
    if (!f) {
      f = { id: uid(), executionId: ex.id, contractorId: cid, lines: [], status: 'DRAFT', schemeFile: null, photoFile: null, updatedAt: nowIso(d), history: [] };
      d.forms.push(f);
    }
    const hadData = f.lines.some((l) => l.linearM > 0);
    f.lines = [];
    f.schemeFile = null;
    f.photoFile = null;
    f.autoZero = true;
    f.status = 'WAITING_PARTNER';
    f.updatedAt = nowIso(d);
    f.history.push(h(d, 'system', 'Отправлена автоматически с нулевым объёмом: весь объём выбран другими подрядчиками', {
      comment: hadData ? 'Данные черновика сброшены. Если вы выполняли работы — отзовите форму и согласуйте объёмы с партнёром.' : undefined,
      highlight: true,
    }));
    notify(d, contractorUserIds(d, [cid]),
      `Весь объём по ${label} выбран другим подрядчиком — ваша форма отправлена автоматически с нулями`, link, { kind: 'important', ex });
  });

  d.forms.filter((x) => x.executionId === ex.id && x.status === 'WAITING_PARTNER').forEach((x) => {
    x.status = 'ON_CHECK_CLIENT';
    x.history.push(h(d, 'system', 'Объёмы сошлись с титулом — форма направлена заказчику'));
  });

  let act = actOf(d, ex.id);
  if (!act) {
    d.actCounter += 1;
    act = {
      id: uid(), number: `АСР-${String(d.actCounter).padStart(4, '0')}`, executionId: ex.id, objectId: obj.id,
      status: 'ON_CHECK_CLIENT', round: 1, createdAt: nowIso(d), updatedAt: nowIso(d), rows: [],
      history: [h(d, 'system', 'Объёмы сошлись с титулом — акт создан и направлен заказчику')],
    };
    d.acts.push(act);
  } else if (act.status === 'IN_REVISION') {
    act.round += 1;
    setActStatus(d, act, 'ON_CHECK_CLIENT', 'system', `Формы исправлены — акт повторно направлен заказчику (редакция ${act.round})`);
  }
  if (ex.titleChange) ex.titleChange = null; // пересчёт после изменения титула выполнен
  syncActRows(d, act);
  notify(d, clientUserIds(d, obj.clientId), `Акт ${act.number} на согласование: ${label}`, `/acts/${act.id}`, { kind: 'action', ex });
  notify(d, staffIds(d), `Акт ${act.number} направлен заказчику: ${label}`, `/acts/${act.id}`, { kind: 'info', ex });
  void userId;
  maybeToGc(d, ex);
  return true;
}

export function withdrawForm(d: Data, userId: string, formId: string) {
  const u = actor(d, userId);
  const form = (d.forms.find((x) => x.id === formId) || fail('Форма не найдена')) as ContractorForm;
  if (u.contractorId !== form.contractorId) fail('Это не ваша форма');
  if (!COUNTED.includes(form.status)) fail('Эту форму нельзя отозвать');
  const { ex, obj, label, link } = exCtx(d, form.executionId);
  if (actLocked(actOf(d, ex.id))) fail('Акт уже у генподрядчика или согласован — отзыв невозможен');
  const wasApproved = form.status === 'APPROVED_BY_CLIENT';
  const name = contractorName(d, form.contractorId);
  form.status = 'DRAFT';
  form.autoZero = false;
  form.updatedAt = nowIso(d);
  form.history.push(h(d, userId, wasApproved ? 'Форма отозвана после одобрения заказчиком' : 'Форма отозвана', { highlight: wasApproved }));
  // автоформы с нулями были созданы из-за этой формы — сбрасываем их тоже
  d.forms.filter((x) => x.executionId === ex.id && x.autoZero && COUNTED.includes(x.status)).forEach((x) => {
    x.status = 'DRAFT';
    x.autoZero = false;
    x.history.push(h(d, 'system', `Автоформа с нулями сброшена: ${name} отозвал свою форму`));
    notify(d, contractorUserIds(d, [x.contractorId]), `${name} отозвал форму (${label}) — ваша автоформа с нулями сброшена, объём снова открыт`, link, { kind: 'action', ex });
  });
  actToRevision(d, ex.id, userId, `${name} отозвал форму — акт на доработке`);
  touch(d, ex);
  if (wasApproved) {
    notify(d, [...staffIds(d), ...clientUserIds(d, obj.clientId)], `${name} отозвал форму после одобрения заказчиком: ${label}`, link, { kind: 'important', ex });
  }
}

// ---------------- Уровень 1: заказчик (по формам) ----------------

function clientCheck(d: Data, userId: string, form: ContractorForm) {
  const u = actor(d, userId);
  const { obj } = exCtx(d, form.executionId);
  if (u.role !== 'CLIENT' || u.clientId !== obj.clientId) fail('Согласовывать формы может только заказчик объекта');
  if (form.status !== 'ON_CHECK_CLIENT') fail('Форма не на проверке заказчика');
}

export function clientApproveForm(d: Data, userId: string, formId: string) {
  const form = (d.forms.find((x) => x.id === formId) || fail('Форма не найдена')) as ContractorForm;
  clientCheck(d, userId, form);
  const { ex } = exCtx(d, form.executionId);
  form.status = 'APPROVED_BY_CLIENT';
  form.updatedAt = nowIso(d);
  form.history.push(h(d, userId, 'Одобрена заказчиком'));
  touch(d, ex);
  maybeToGc(d, ex);
}

export function clientRejectForm(d: Data, userId: string, formId: string, comment: string) {
  if (!comment.trim()) fail('Укажите комментарий');
  const form = (d.forms.find((x) => x.id === formId) || fail('Форма не найдена')) as ContractorForm;
  clientCheck(d, userId, form);
  const { ex, label, link } = exCtx(d, form.executionId);
  form.status = 'REJECTED_BY_CLIENT';
  form.updatedAt = nowIso(d);
  form.history.push(h(d, userId, 'Отклонена заказчиком', { comment }));
  actToRevision(d, ex.id, userId, `Заказчик отклонил форму: ${contractorName(d, form.contractorId)}`, { comment });
  touch(d, ex);
  notify(d, contractorUserIds(d, [form.contractorId]), `Форма отклонена заказчиком (${label}): ${comment}`, link, { kind: 'action', ex });
  notify(d, staffIds(d), `Заказчик отклонил форму ${contractorName(d, form.contractorId)} (${label}): ${comment}`, link, { kind: 'important', ex });
}

/** Все формы одобрены заказчиком и сумма = титул → акт уходит ГП. */
function maybeToGc(d: Data, ex: Execution) {
  const act = actOf(d, ex.id);
  if (!act || act.status !== 'ON_CHECK_CLIENT') return;
  const forms = ex.contractorIds.map((c) => d.forms.find((f) => f.executionId === ex.id && f.contractorId === c));
  if (!forms.every((f) => f && f.status === 'APPROVED_BY_CLIENT')) return;
  if (!isComplete(d, executionBalance(d, ex))) return;
  syncActRows(d, act);
  setActStatus(d, act, 'ON_CHECK_GC', 'system', 'Заказчик одобрил все формы — акт направлен генподрядчику');
  const { label } = exCtx(d, ex.id);
  notify(d, staffIds(d), `Заказчик одобрил все формы, акт ${act.number} ждёт проверки ГП: ${label}`, `/acts/${act.id}`, { kind: 'action', ex });
}

// ---------------- Уровень 2: генподрядчик (акт целиком) ----------------

function getAct(d: Data, actId: string) {
  return (d.acts.find((a) => a.id === actId) || fail('Акт не найден')) as Act;
}

export function gcApproveAct(d: Data, userId: string, actId: string) {
  if (!isStaff(actor(d, userId).role)) fail('Нет прав');
  const act = getAct(d, actId);
  if (act.status !== 'ON_CHECK_GC') fail('Акт не на проверке ГП');
  const { ex, obj, label } = exCtx(d, act.executionId);
  setActStatus(d, act, 'APPROVED', userId, 'Акт согласован генподрядчиком');
  touch(d, ex);
  notify(d, [...contractorUserIds(d, ex.contractorIds), ...clientUserIds(d, obj.clientId)], `Акт ${act.number} согласован: ${label}`, `/acts/${act.id}`, { kind: 'info', ex });
}

/** ГП возвращает акт: выбранные формы уходят подрядчикам, после исправления — снова к заказчику. */
export function gcReturnAct(d: Data, userId: string, actId: string, contractorIds: string[], comment: string) {
  if (!isStaff(actor(d, userId).role)) fail('Нет прав');
  if (!comment.trim()) fail('Укажите комментарий');
  if (!contractorIds.length) fail('Выберите хотя бы одного подрядчика');
  const act = getAct(d, actId);
  if (act.status !== 'ON_CHECK_GC') fail('Акт не на проверке ГП');
  const { ex, obj, label, link } = exCtx(d, act.executionId);
  const names = contractorIds.map((c) => contractorName(d, c)).join(', ');
  d.forms.filter((f) => f.executionId === ex.id && contractorIds.includes(f.contractorId)).forEach((f) => {
    f.status = 'REJECTED_BY_GC';
    f.autoZero = false;
    f.updatedAt = nowIso(d);
    f.history.push(h(d, userId, 'Возвращена генподрядчиком', { comment, hiddenFromClient: true }));
  });
  setActStatus(d, act, 'IN_REVISION', userId, `Акт возвращён ГП на доработку: ${names}`, { comment, hiddenFromClient: true });
  syncActRows(d, act);
  touch(d, ex);
  notify(d, contractorUserIds(d, contractorIds), `Генподрядчик вернул форму (${label}): ${comment}`, link, { kind: 'action', ex });
  notify(d, clientUserIds(d, obj.clientId), `Акт ${act.number} возвращён на доработку подрядчикам: ${label}`, `/acts/${act.id}`, { kind: 'info', ex });
}

export function downloadWordLog(d: Data, userId: string, actId: string) {
  const u = actor(d, userId);
  if (!(isStaff(u.role) || u.role === 'CLIENT')) fail('Нет прав');
  const act = getAct(d, actId);
  if (!['APPROVED', 'ARCHIVED'].includes(act.status)) fail('Word доступен только для согласованного акта');
  act.wordDownloadedAt = nowIso(d);
  act.history.push(h(d, userId, 'Выгружен акт в формате Word (шаблон пока пустой)'));
}

export function archiveAct(d: Data, userId: string, actId: string) {
  if (!isStaff(actor(d, userId).role)) fail('Нет прав');
  const act = getAct(d, actId);
  if (act.status !== 'APPROVED') fail('В архив можно перевести только согласованный акт');
  act.archivedAt = nowIso(d);
  setActStatus(d, act, 'ARCHIVED', userId, 'Акт переведён в архив');
}

/** Корректировка после согласования — только ГП, с обязательной причиной. */
export function correctAct(d: Data, userId: string, actId: string, rows: { contractorId: string; lines: FormLine[] }[], reason: string) {
  if (actor(d, userId).role !== 'GC') fail('Корректировка после согласования доступна только генподрядчику');
  if (!reason.trim()) fail('Укажите причину корректировки');
  const act = getAct(d, actId);
  if (!['APPROVED', 'ARCHIVED'].includes(act.status)) fail('Корректировка доступна только для согласованных актов');
  const changes: string[] = [];
  rows.forEach((r) => {
    const row = act.rows.find((x) => x.contractorId === r.contractorId);
    if (!row) return;
    r.lines.forEach((l) => {
      const old = row.lines.find((x) => x.markingTypeId === l.markingTypeId);
      const oldV = old?.linearM || 0;
      if (round2(oldV) !== round2(l.linearM)) {
        const mt = d.markingTypes.find((m) => m.id === l.markingTypeId);
        changes.push(`${contractorName(d, r.contractorId)}, ${mt?.code}: ${fmt(oldV)} → ${fmt(l.linearM)} п.м`);
        if (old) old.linearM = round2(l.linearM);
        else row.lines.push({ markingTypeId: l.markingTypeId, linearM: round2(l.linearM) });
      }
    });
    row.lines = row.lines.filter((l) => l.linearM > 0);
    const form = d.forms.find((f) => f.executionId === act.executionId && f.contractorId === r.contractorId);
    if (form) form.lines = structuredClone(row.lines);
  });
  if (!changes.length) fail('Изменений нет');
  act.updatedAt = nowIso(d);
  act.history.push(h(d, userId, `Корректировка ГП: ${changes.join('; ')}`, { comment: reason, highlight: true }));
}

// ---------------- Выполнение и изменение титула ----------------

/** Создавать, изменять и удалять объекты/выполнения могут только ГП и заказчик (свои объекты). */
export function canManageObjects(u: User, obj?: { clientId: string } | null) {
  return u.role === 'GC' || (u.role === 'CLIENT' && (!obj || obj.clientId === u.clientId));
}

function managerCheck(d: Data, userId: string, objectId?: string | null) {
  const u = actor(d, userId);
  const obj = objectId ? d.objects.find((o) => o.id === objectId) : null;
  if (!canManageObjects(u, obj)) fail('Создавать, изменять и удалять объекты и выполнения могут только генподрядчик и заказчик');
  return u;
}

export const allocatedM2 = (d: Data, objectId: string, exceptExId?: string) =>
  round2(d.executions.filter((e) => e.objectId === objectId && e.id !== exceptExId).reduce((s, e) => s + e.titleM2, 0));

export interface ObjectPatch {
  excelRowNumber: number; name: string; address: string; district: string; clientId: string; titleM2: number;
}

export function saveObject(d: Data, userId: string, objectId: string | null, p: ObjectPatch): string {
  const u = managerCheck(d, userId, objectId);
  const patch = { ...p, titleM2: round2(Number(p.titleM2) || 0) };
  if (u.role === 'CLIENT') patch.clientId = u.clientId!;
  if (!patch.titleM2 || patch.titleM2 <= 0) fail('Укажите общий объём объекта');
  if (d.objects.some((o) => o.excelRowNumber === patch.excelRowNumber && o.id !== objectId)) fail(`№ п/п ${patch.excelRowNumber} уже занят`);
  if (objectId) {
    const obj = d.objects.find((o) => o.id === objectId) || fail('Объект не найден');
    const alloc = allocatedM2(d, objectId);
    if (patch.titleM2 < alloc - 1e-9) fail(`Общий объём не может быть меньше распределённого по выполнениям (${fmt(alloc)} м²)`);
    Object.assign(obj as object, patch);
    return objectId;
  }
  const id = uid();
  d.objects.push({ id, createdAt: nowIso(d), ...patch });
  return id;
}

function deletable(d: Data, exId: string) {
  const act = actOf(d, exId);
  if (act && ['APPROVED', 'ARCHIVED'].includes(act.status)) {
    fail(`По выполнению есть ${act.status === 'ARCHIVED' ? 'архивный' : 'согласованный'} акт ${act.number} — удаление запрещено`);
  }
}

function purgeExecution(d: Data, ex: Execution) {
  const act = actOf(d, ex.id);
  d.forms = d.forms.filter((f) => f.executionId !== ex.id);
  if (act) d.acts = d.acts.filter((a) => a.id !== act.id);
  d.notifications = d.notifications.filter((n) => n.executionId !== ex.id);
  d.executions = d.executions.filter((e) => e.id !== ex.id);
}

export function deleteExecution(d: Data, userId: string, exId: string) {
  const { ex, obj, label } = exCtx(d, exId);
  const u = managerCheck(d, userId, obj.id);
  deletable(d, exId);
  const hadForms = d.forms.some((f) => f.executionId === exId);
  purgeExecution(d, ex);
  const msg = `${u.name} удалил ${label}`;
  if (hadForms) notify(d, contractorUserIds(d, ex.contractorIds), msg, `/objects/${obj.id}`, { kind: 'important' });
  notify(d, [...staffIds(d), ...clientUserIds(d, obj.clientId)].filter((x) => x !== userId), msg, `/objects/${obj.id}`, { kind: 'important' });
}

export function deleteObject(d: Data, userId: string, objectId: string) {
  const u = managerCheck(d, userId, objectId);
  const obj = (d.objects.find((o) => o.id === objectId) || fail('Объект не найден')) as { id: string; name: string; clientId: string; excelRowNumber: number };
  const exs = d.executions.filter((e) => e.objectId === objectId);
  exs.forEach((e) => deletable(d, e.id));
  const contractors = [...new Set(exs.flatMap((e) => e.contractorIds))];
  exs.forEach((e) => purgeExecution(d, e));
  d.chat = d.chat.filter((m) => m.objectId !== objectId);
  d.notifications = d.notifications.filter((n) => n.objectId !== objectId);
  d.objects = d.objects.filter((o) => o.id !== objectId);
  const msg = `${u.name} удалил объект №${obj.excelRowNumber} «${obj.name}»`;
  notify(d, [...contractorUserIds(d, contractors), ...staffIds(d), ...clientUserIds(d, obj.clientId)].filter((x) => x !== userId), msg, '/objects', { kind: 'important' });
}

export interface ExecutionPatch {
  number: number; name: string; periodFrom: string; periodTo: string; titleM2: number; contractorIds: string[];
}

export function saveExecution(d: Data, userId: string, objectId: string, exId: string | null, p: ExecutionPatch, reason: string) {
  managerCheck(d, userId, objectId);
  if (!p.contractorIds.length) fail('Назначьте хотя бы одного подрядчика');
  const obj = (d.objects.find((o) => o.id === objectId) || fail('Объект не найден')) as { titleM2: number };
  const newTitle = round2(Number(p.titleM2) || 0);
  if (newTitle <= 0) fail('Укажите объём выполнения');
  const others = allocatedM2(d, objectId, exId || undefined);
  if (others + newTitle > obj.titleM2 + 1e-9) {
    fail(`Объём выполнений превысит объём объекта: ${fmt(others)} + ${fmt(newTitle)} > ${fmt(obj.titleM2)} м². Доступно: ${fmt(obj.titleM2 - others)} м²`);
  }
  if (d.executions.some((e) => e.objectId === objectId && e.number === p.number && e.id !== exId)) fail(`Выполнение №${p.number} уже есть на объекте`);
  if (!exId) {
    const ex: Execution = {
      id: uid(), objectId, ...p, titleM2: newTitle, lastActivityAt: nowIso(d), reminderLevel: 0,
      history: [h(d, userId, `Выполнение создано, объём ${fmt(newTitle)} м²`)], titleChange: null,
    };
    d.executions.push(ex);
    return;
  }
  const { ex } = exCtx(d, exId);
  const hasForms = d.forms.some((f) => f.executionId === ex.id && f.status !== 'DRAFT');
  const contractorsChanged = [...p.contractorIds].sort().join() !== [...ex.contractorIds].sort().join();
  if (contractorsChanged && hasForms) fail('Состав подрядчиков можно менять, пока нет поданных форм');
  if (newTitle !== ex.titleM2) changeTitle(d, userId, ex, newTitle, reason);
  Object.assign(ex, { number: p.number, name: p.name, periodFrom: p.periodFrom, periodTo: p.periodTo, contractorIds: p.contractorIds });
}

/**
 * Изменение титула в ходе согласования: все поданные формы (в т.ч. одобренные заказчиком)
 * получают статус «Изменён титул», акт уходит на доработку, всё пишется в журнал и рассылается.
 */
export function changeTitle(d: Data, userId: string, ex: Execution, newTitle: number, reason: string) {
  const act = actOf(d, ex.id);
  if (act && ['APPROVED', 'ARCHIVED'].includes(act.status)) {
    fail('Акт уже согласован — титул изменить нельзя. Используйте «Корректировку» в карточке акта.');
  }
  const old = ex.titleM2;
  const inFlow = d.forms.some((f) => f.executionId === ex.id && f.status !== 'DRAFT');
  if (inFlow && !reason.trim()) fail('Укажите причину изменения титула — по выполнению уже идёт согласование');
  ex.titleM2 = newTitle;
  ex.history.push(h(d, userId, `Изменён титульный объём: ${fmt(old)} → ${fmt(newTitle)} м²`, { comment: reason || undefined, highlight: inFlow }));
  if (!inFlow) return;

  const { obj, label, link } = exCtx(d, ex.id);
  ex.titleChange = { from: old, to: newTitle, at: nowIso(d), userId, reason };
  const affected: string[] = [];
  d.forms.filter((f) => f.executionId === ex.id && f.status !== 'DRAFT').forEach((f) => {
    const was = f.status;
    f.status = 'TITLE_CHANGED';
    f.autoZero = false;
    f.updatedAt = nowIso(d);
    f.history.push(h(d, userId, `Изменён титул ${fmt(old)} → ${fmt(newTitle)} м² — форма возвращена на пересчёт (была: ${was === 'APPROVED_BY_CLIENT' ? 'одобрена заказчиком' : 'подана'})`, { comment: reason, highlight: true }));
    affected.push(f.contractorId);
  });
  if (act && ['ON_CHECK_CLIENT', 'IN_REVISION', 'ON_CHECK_GC'].includes(act.status)) {
    setActStatus(d, act, 'IN_REVISION', userId, `Изменён титул ${fmt(old)} → ${fmt(newTitle)} м² — акт возвращён на пересчёт, одобрения заказчика сняты`, { comment: reason, highlight: true });
    syncActRows(d, act);
  }
  touch(d, ex);
  const msg = `Изменён титул по ${label}: ${fmt(old)} → ${fmt(newTitle)} м². Формы возвращены на пересчёт.`;
  notify(d, contractorUserIds(d, affected), `${msg} Проверьте объёмы и подайте форму заново.`, link, { kind: 'action', ex });
  notify(d, clientUserIds(d, obj.clientId), `${msg} Акт вернётся к вам после пересчёта.`, act ? `/acts/${act.id}` : link, { kind: 'important', ex });
  notify(d, staffIds(d), msg, link, { kind: 'important', ex });
}

// ---------------- Чат ----------------

export function sendChat(d: Data, userId: string, objectId: string, text: string) {
  if (!text.trim()) return;
  d.chat.push({ id: uid(), objectId, userId, text: text.trim(), at: nowIso(d) });
}

// ---------------- Напоминания ----------------

/**
 * Подрядчикам — по каждому выполнению (их немного). ГП и менеджерам — одна сводка за проверку,
 * чтобы при сотнях объектов не засыпать ленту однотипными сообщениями.
 */
export function checkReminders(d: Data) {
  const { remindFirstDays: d1, remindSecondDays: d2 } = d.settings;
  const now = nowMs(d);
  const staleForStaff: string[] = [];
  d.executions.forEach((ex) => {
    const act = actOf(d, ex.id);
    if (act && ['APPROVED', 'ARCHIVED'].includes(act.status)) return;
    if (!d.forms.some((f) => f.executionId === ex.id) && !act) return;
    const idleDays = (now - new Date(ex.lastActivityAt).getTime()) / DAY;
    const { label, link } = exCtx(d, ex.id);
    const short = shortage(executionBalance(d, ex));
    if (idleDays >= d2 && ex.reminderLevel < 2) {
      ex.reminderLevel = 2;
      notify(d, contractorUserIds(d, ex.contractorIds), `Акт висит ${d2} дн., требуется вмешательство: ${label}`, link, { kind: 'reminder', ex });
      staleForStaff.push(label);
    } else if (idleDays >= d1 && ex.reminderLevel < 1) {
      ex.reminderLevel = 1;
      if (short > 0) notify(d, contractorUserIds(d, ex.contractorIds), `Акт висит ${d1} дн., недостача: ${fmt(short)} м² (${label})`, link, { kind: 'reminder', ex });
    }
  });
  if (staleForStaff.length) {
    const list = staleForStaff.slice(0, 5).join('; ') + (staleForStaff.length > 5 ? ` и ещё ${staleForStaff.length - 5}` : '');
    notify(d, staffIds(d), `Сводка: ${staleForStaff.length} выполн. без решения ≥ ${d2} дн. — ${list}`, '/objects', { kind: 'reminder' });
  }
}

export { BizError };
