import type {
  Act, ContractorForm, Data, Execution, FormLine, FormStatus, HistoryEntry, MarkingType, Role, SiteObject, User,
} from './types';

export const DAY = 86400000;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmt = (n: number) =>
  round2(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const coef = (mt?: MarkingType) => (mt ? mt.widthM * mt.fillRatio : 0);

export function lineM2(data: Data, l: FormLine) {
  if (l.m2 != null) return l.m2;
  const mt = data.markingTypes.find((m) => m.id === l.markingTypeId);
  return round2((l.linearM || 0) * coef(mt));
}

export const linesM2 = (data: Data, lines: FormLine[]) => round2(lines.reduce((s, l) => s + lineM2(data, l), 0));

/** Формы, которые участвуют в сверке объёма (поданы и не возвращены). */
export const COUNTED: FormStatus[] = ['WAITING_PARTNER', 'ON_CHECK_CLIENT', 'APPROVED_BY_CLIENT'];
/** Формы, которые подрядчик может редактировать. */
export const EDITABLE: FormStatus[] = ['DRAFT', 'REJECTED_BY_CLIENT', 'REJECTED_BY_GC', 'TITLE_CHANGED'];

export const formTotalM2 = (data: Data, f: ContractorForm) => linesM2(data, f.lines);

export interface Balance {
  title: number;
  submitted: number; // сумма поданных форм, м²
  diff: number; // submitted − title (<0 недостача, >0 перебор)
}

export function executionBalance(data: Data, ex: Execution, extra?: ContractorForm): Balance {
  const forms = data.forms.filter(
    (f) => f.executionId === ex.id && COUNTED.includes(f.status) && (!extra || f.id !== extra.id),
  );
  if (extra) forms.push(extra);
  const submitted = round2(forms.reduce((s, f) => s + formTotalM2(data, f), 0));
  return { title: ex.titleM2, submitted, diff: round2(submitted - ex.titleM2) };
}

export const isComplete = (data: Data, b: Balance) => Math.abs(b.diff) <= data.settings.toleranceM2 + 1e-9;
export const shortage = (b: Balance) => round2(Math.max(0, -b.diff));

export const actOf = (data: Data, exId: string) => data.acts.find((a) => a.executionId === exId);
/** Акт «заблокирован» для подрядчиков: ушёл к ГП или согласован. */
export const actLocked = (a?: Act) => !!a && ['ON_CHECK_GC', 'APPROVED', 'ARCHIVED'].includes(a.status);

export type Stage =
  | 'FILLING' | 'WAITING_PARTNER' | 'ON_CHECK_CLIENT' | 'IN_REVISION' | 'ON_CHECK_GC' | 'APPROVED' | 'ARCHIVED';

export const STAGE: Record<Stage, { label: string; color: string }> = {
  FILLING: { label: 'Заполнение форм', color: 'default' },
  WAITING_PARTNER: { label: 'Недостача / ожидание партнёра', color: 'gold' },
  ON_CHECK_CLIENT: { label: 'Проверка заказчика', color: 'blue' },
  IN_REVISION: { label: 'На доработке', color: 'orange' },
  ON_CHECK_GC: { label: 'Проверка ГП', color: 'geekblue' },
  APPROVED: { label: 'Согласован', color: 'green' },
  ARCHIVED: { label: 'В архиве', color: 'purple' },
};

export function executionStage(data: Data, ex: Execution): Stage {
  const act = actOf(data, ex.id);
  if (act) return act.status as Stage;
  const forms = data.forms.filter((f) => f.executionId === ex.id);
  if (forms.some((f) => f.status === 'WAITING_PARTNER')) return 'WAITING_PARTNER';
  return 'FILLING';
}

// ---------- Видимость ----------

export const isStaff = (r: Role) => r === 'GC' || r === 'MANAGER';

export function visibleObjects(data: Data, u: User): SiteObject[] {
  if (isStaff(u.role)) return data.objects;
  if (u.role === 'CLIENT') return data.objects.filter((o) => o.clientId === u.clientId);
  const exObjIds = new Set(
    data.executions.filter((e) => e.contractorIds.includes(u.contractorId || '')).map((e) => e.objectId),
  );
  return data.objects.filter((o) => exObjIds.has(o.id));
}

export function visibleExecutions(data: Data, u: User, objectId: string): Execution[] {
  const all = data.executions.filter((e) => e.objectId === objectId).sort((a, b) => a.number - b.number);
  if (u.role === 'CONTRACTOR') return all.filter((e) => e.contractorIds.includes(u.contractorId || ''));
  return all;
}

export function visibleActs(data: Data, u: User): Act[] {
  if (isStaff(u.role)) return data.acts;
  if (u.role === 'CLIENT') {
    const ids = new Set(data.objects.filter((o) => o.clientId === u.clientId).map((o) => o.id));
    return data.acts.filter((a) => ids.has(a.objectId));
  }
  return data.acts.filter((a) => {
    const ex = data.executions.find((e) => e.id === a.executionId);
    return !!ex && ex.contractorIds.includes(u.contractorId || '');
  });
}

export function canDownloadFile(data: Data, u: User, fileId: string): boolean {
  if (isStaff(u.role)) return true;
  const inFile = (x: { schemeFile?: { id: string } | null; photoFile?: { id: string } | null }) =>
    x.schemeFile?.id === fileId || x.photoFile?.id === fileId;
  if (u.role === 'CONTRACTOR') {
    return data.forms.some((f) => f.contractorId === u.contractorId && inFile(f))
      || data.acts.some((a) => a.rows.some((r) => r.contractorId === u.contractorId && inFile(r)));
  }
  // Заказчик — через акт
  return visibleActs(data, u).some((a) => a.rows.some(inFile));
}

// ---------- Журнал выполнения ----------

export interface JournalEntry extends HistoryEntry {
  source: string; // «Выполнение», «Акт», название подрядчика
}

/** Единый журнал по выполнению с учётом прав: подрядчик — только свою форму, заказчик — без комментариев ГП. */
export function executionJournal(data: Data, u: User, ex: Execution): JournalEntry[] {
  const out: JournalEntry[] = [];
  const hide = (h: HistoryEntry) => u.role === 'CLIENT' && h.hiddenFromClient;
  ex.history.forEach((h) => out.push({ ...h, source: 'Выполнение' }));
  data.forms.filter((f) => f.executionId === ex.id).forEach((f) => {
    if (u.role === 'CONTRACTOR' && f.contractorId !== u.contractorId) return;
    const name = data.contractors.find((c) => c.id === f.contractorId)?.name || '—';
    f.history.forEach((h) => {
      // заказчик не видит черновики/внутреннюю кухню до подачи на проверку
      if (u.role === 'CLIENT' && /создана|сохранена/i.test(h.action)) return;
      out.push({ ...h, comment: hide(h) ? undefined : h.comment, source: `Форма: ${name}` });
    });
  });
  const act = actOf(data, ex.id);
  act?.history.forEach((h) => out.push({ ...h, comment: hide(h) ? undefined : h.comment, source: `Акт ${act.number}` }));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
