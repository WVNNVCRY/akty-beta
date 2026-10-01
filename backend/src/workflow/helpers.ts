import { ActStatus, FormStatus, Prisma } from '@prisma/client';
import { biz, notFound } from '../common/errors';

export type Tx = Prisma.TransactionClient;

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
export const fmt = (x: number) => r2(x).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Формы, которые участвуют в сверке объёма (поданы и не возвращены). */
export const COUNTED: FormStatus[] = ['WAITING_PARTNER', 'ON_CHECK_CLIENT', 'APPROVED_BY_CLIENT'];
/** Формы, которые подрядчик может редактировать. */
export const EDITABLE: FormStatus[] = ['DRAFT', 'REJECTED_BY_CLIENT', 'REJECTED_BY_GC', 'TITLE_CHANGED'];
/** Акт «заблокирован» для подрядчиков: ушёл к ГП или согласован. */
export const actLocked = (s?: ActStatus | null) => !!s && (['ON_CHECK_GC', 'APPROVED', 'ARCHIVED'] as ActStatus[]).includes(s);
export const actFinal = (s?: ActStatus | null) => s === 'APPROVED' || s === 'ARCHIVED';

/**
 * Блокировка строки выполнения до конца транзакции. Все операции над формами/актом
 * одного выполнения идут строго по очереди — два подрядчика, подавшие формы одновременно,
 * не «проскочат» мимо сверки суммы с титулом.
 */
export async function lockEx(tx: Tx, exId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM executions WHERE id = ${exId}::uuid FOR UPDATE`;
  if (!rows.length) notFound('Выполнение не найдено');
}

export const exInclude = {
  object: true,
  contractors: { orderBy: { assignedAt: 'asc' } },
  forms: { include: { lines: true } },
  act: true,
} satisfies Prisma.ExecutionInclude;
export type ExFull = Prisma.ExecutionGetPayload<{ include: typeof exInclude }>;

export async function loadEx(tx: Tx, exId: string): Promise<ExFull> {
  const ex = await tx.execution.findUnique({ where: { id: exId }, include: exInclude });
  return ex ?? notFound('Выполнение не найдено');
}

export const contractorIdsOf = (ex: ExFull) => ex.contractors.map((c) => c.contractorId);
export const exLabel = (ex: ExFull) => ({
  label: `«${ex.object.name}», ${ex.name}`,
  link: `/objects/${ex.objectId}?ex=${ex.id}`,
  rel: { objectId: ex.objectId, executionId: ex.id },
});

export interface Balance { title: number; submitted: number; diff: number }

/** Сумма поданных форм против титула. override — «как будто» форма уже подана с этим объёмом. */
export function balance(ex: ExFull, override?: { formId: string; totalM2: number }): Balance {
  let submitted = ex.forms
    .filter((f) => COUNTED.includes(f.status) && f.id !== override?.formId)
    .reduce((s, f) => s + n(f.totalM2), 0);
  if (override) submitted += override.totalM2;
  submitted = r2(submitted);
  const title = n(ex.titleM2);
  return { title, submitted, diff: r2(submitted - title) };
}
export const isComplete = (b: Balance, tol: number) => Math.abs(b.diff) <= tol + 1e-9;
export const shortage = (b: Balance) => r2(Math.max(0, -b.diff));

export async function getSettings(tx: Tx) {
  return tx.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export interface HistInput {
  userId?: string | null; action: string; comment?: string | null; highlight?: boolean; hiddenFromClient?: boolean;
  visibleToContractorId?: string | null; meta?: Prisma.InputJsonValue;
  executionId?: string; formId?: string; actId?: string;
}
export const hist = (tx: Tx, h: HistInput) =>
  tx.historyEntry.create({
    data: {
      userId: h.userId ?? null, action: h.action, comment: h.comment || null, highlight: !!h.highlight,
      hiddenFromClient: !!h.hiddenFromClient, visibleToContractorId: h.visibleToContractorId ?? null, meta: h.meta,
      executionId: h.executionId, formId: h.formId, actId: h.actId,
    },
  });

/** Движение по выполнению — сбрасывает счётчик напоминаний. */
export const touch = (tx: Tx, exId: string) =>
  tx.execution.update({ where: { id: exId }, data: { lastActivityAt: new Date(), reminderLevel: 0 } });

export async function contractorNames(tx: Tx, ids: string[]) {
  const list = await tx.contractor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const map = new Map(list.map((c) => [c.id, c.name]));
  return (id: string) => map.get(id) || '—';
}

export async function setActStatus(tx: Tx, actId: string, status: ActStatus, userId: string | null, action: string, extra: Partial<HistInput> = {}) {
  await tx.act.update({ where: { id: actId }, data: { status } });
  await hist(tx, { ...extra, userId, action, actId });
}

/** Обновить снимок строк акта из текущих форм (пока акт не у ГП). Файлы — ссылки на те же StoredFile. */
export async function syncActRows(tx: Tx, actId: string, exId: string) {
  const ex = await loadEx(tx, exId);
  await tx.actRow.deleteMany({ where: { actId } });
  let total = 0;
  for (const cid of contractorIdsOf(ex)) {
    const f = ex.forms.find((x) => x.contractorId === cid);
    total += n(f?.totalM2);
    await tx.actRow.create({
      data: {
        actId, contractorId: cid, autoZero: !!f?.autoZero, totalM2: f?.totalM2 ?? 0,
        schemeFileId: f?.schemeFileId ?? null, photoFileId: f?.photoFileId ?? null,
        lines: {
          create: (f?.lines || []).map(({ markingTypeId, linearM, widthM, fillRatio, areaM2 }) => ({ markingTypeId, linearM, widthM, fillRatio, areaM2 })),
        },
      },
    });
  }
  await tx.act.update({ where: { id: actId }, data: { totalM2: r2(total) } });
}

/** Перевести акт на доработку (если он был у заказчика) и обновить строки. */
export async function actToRevision(tx: Tx, ex: ExFull, userId: string | null, action: string, extra: Partial<HistInput> = {}) {
  if (!ex.act) return;
  if (ex.act.status === 'ON_CHECK_CLIENT') await setActStatus(tx, ex.act.id, 'IN_REVISION', userId, action, extra);
  await syncActRows(tx, ex.act.id, ex.id);
}

/** Строки формы: объединить дубли, отбросить пустые/неизвестные виды, посчитать м² со снимком коэффициентов. */
export async function buildLines(tx: Tx, input: { markingTypeId: string; linearM: number }[]) {
  const types = await tx.markingType.findMany();
  const byId = new Map(types.map((t) => [t.id, t]));
  const sum = new Map<string, number>();
  for (const l of input) {
    if (!byId.has(l.markingTypeId)) continue;
    sum.set(l.markingTypeId, r2((sum.get(l.markingTypeId) || 0) + Math.max(0, Number(l.linearM) || 0)));
  }
  const lines = [...sum.entries()].map(([markingTypeId, linearM]) => {
    const t = byId.get(markingTypeId)!;
    return { markingTypeId, linearM, widthM: t.widthM, fillRatio: t.fillRatio, areaM2: r2(linearM * n(t.widthM) * n(t.fillRatio)) };
  });
  return { lines, total: r2(lines.reduce((s, l) => s + l.areaM2, 0)), codeOf: (id: string) => byId.get(id)?.code || '?' };
}

export { biz };
