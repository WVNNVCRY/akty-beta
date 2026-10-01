import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common/auth';
import { biz, forbid, notFound } from '../common/errors';
import { StorageService } from '../files/storage.service';
import { NotifyService } from '../notifications/notify.service';
import { PrismaService } from '../prisma.service';
import { Tx, actFinal, contractorIdsOf, exLabel, fmt, hist, loadEx, lockEx, n, r2, setActStatus, syncActRows, touch } from './helpers';

export interface ObjectInput { excelRowNumber: number; name: string; address: string; district: string; clientId: string; titleM2: number }
export interface ExecutionInput { number: number; name: string; periodFrom: string; periodTo: string; titleM2: number; contractorIds: string[] }

/** Создавать, изменять и удалять объекты/выполнения могут только ГП и заказчик (свои объекты). */
export const canManageObjects = (u: AuthUser, obj?: { clientId: string } | null) =>
  u.role === 'GC' || (u.role === 'CLIENT' && (!obj || obj.clientId === u.clientId));

@Injectable()
export class ObjectsService {
  constructor(private prisma: PrismaService, private notifier: NotifyService, private storage: StorageService) {}

  private manager(u: AuthUser, obj?: { clientId: string } | null) {
    if (!canManageObjects(u, obj)) forbid('Создавать, изменять и удалять объекты и выполнения могут только генподрядчик и заказчик');
  }

  private async allocated(tx: Tx, objectId: string, exceptExId?: string | null) {
    const r = await tx.execution.aggregate({ where: { objectId, ...(exceptExId ? { id: { not: exceptExId } } : {}) }, _sum: { titleM2: true } });
    return r2(n(r._sum.titleM2));
  }

  // ---------------- Объекты ----------------

  async saveObject(u: AuthUser, objectId: string | null, p: ObjectInput) {
    return this.prisma.$transaction(async (tx) => {
      const existing = objectId ? await tx.siteObject.findUnique({ where: { id: objectId } }) : null;
      if (objectId && !existing) notFound('Объект не найден');
      this.manager(u, existing);
      const data = { ...p, titleM2: r2(Number(p.titleM2) || 0), clientId: u.role === 'CLIENT' ? u.clientId! : p.clientId };
      if (!data.titleM2 || data.titleM2 <= 0) biz('Укажите общий объём объекта');
      if (!(await tx.client.findUnique({ where: { id: data.clientId } }))) biz('Заказчик не найден');
      const dup = await tx.siteObject.findFirst({ where: { excelRowNumber: data.excelRowNumber, ...(objectId ? { id: { not: objectId } } : {}) } });
      if (dup) biz(`№ п/п ${data.excelRowNumber} уже занят`);
      if (existing) {
        const alloc = await this.allocated(tx, existing.id);
        if (data.titleM2 < alloc - 1e-9) biz(`Общий объём не может быть меньше распределённого по выполнениям (${fmt(alloc)} м²)`);
        await tx.siteObject.update({ where: { id: existing.id }, data });
        return { id: existing.id, message: 'Объект сохранён' };
      }
      const o = await tx.siteObject.create({ data: { ...data, createdById: u.id } });
      return { id: o.id, message: 'Объект создан' };
    });
  }

  private async deletable(tx: Tx, exId: string) {
    const act = await tx.act.findUnique({ where: { executionId: exId } });
    if (act && actFinal(act.status)) {
      biz(`По выполнению есть ${act.status === 'ARCHIVED' ? 'архивный' : 'согласованный'} акт ${act.number} — удаление запрещено`);
    }
  }

  /** Файлы форм/актов выполнений — удаляются из хранилища после коммита. */
  private async filesOf(tx: Tx, exIds: string[]) {
    const forms = await tx.contractorForm.findMany({ where: { executionId: { in: exIds } }, select: { schemeFileId: true, photoFileId: true } });
    const rows = await tx.actRow.findMany({ where: { act: { executionId: { in: exIds } } }, select: { schemeFileId: true, photoFileId: true } });
    const ids = [...new Set([...forms, ...rows].flatMap((x) => [x.schemeFileId, x.photoFileId]).filter((x): x is string => !!x))];
    return tx.storedFile.findMany({ where: { id: { in: ids } } });
  }

  private async purgeFiles(files: { key: string; bucket: string }[]) {
    for (const f of files) await this.storage.remove(f.key, f.bucket);
  }

  async deleteObject(u: AuthUser, objectId: string) {
    const files = await this.prisma.$transaction(async (tx) => {
      const obj = await tx.siteObject.findUnique({ where: { id: objectId }, include: { executions: { include: { contractors: true } } } });
      if (!obj) notFound('Объект не найден');
      this.manager(u, obj);
      for (const e of obj!.executions) {
        await lockEx(tx, e.id);
        await this.deletable(tx, e.id);
      }
      const exIds = obj!.executions.map((e) => e.id);
      const files = await this.filesOf(tx, exIds);
      const contractors = [...new Set(obj!.executions.flatMap((e) => e.contractors.map((c) => c.contractorId)))];
      const words = await tx.act.findMany({ where: { objectId, wordFileId: { not: null } }, select: { wordFile: true } });
      await tx.siteObject.delete({ where: { id: objectId } }); // каскад: выполнения, формы, акт, журнал, чат, уведомления
      await tx.storedFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
      const msg = `${u.name} удалил объект №${obj!.excelRowNumber ?? '—'} «${obj!.name}»`;
      const to = [
        ...(await this.notifier.contractorUserIds(tx, contractors)), ...(await this.notifier.staffIds(tx)),
        ...(await this.notifier.clientUserIds(tx, obj!.clientId)),
      ].filter((x) => x !== u.id);
      await this.notifier.notify(tx, to, msg, '/objects', { kind: 'IMPORTANT' });
      return [...files, ...words.map((w) => w.wordFile!).filter(Boolean)];
    });
    await this.purgeFiles(files);
    return { message: 'Объект удалён' };
  }

  // ---------------- Выполнения ----------------

  async saveExecution(u: AuthUser, objectId: string, exId: string | null, p: ExecutionInput, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const obj = await tx.siteObject.findUnique({ where: { id: objectId } });
      if (!obj) notFound('Объект не найден');
      this.manager(u, obj);
      // Блокируем объект: два одновременных создания выполнений не превысят его объём
      await tx.$queryRaw`SELECT id FROM objects WHERE id = ${objectId}::uuid FOR UPDATE`;
      const ids = [...new Set(p.contractorIds)];
      if (!ids.length) biz('Назначьте хотя бы одного подрядчика');
      if ((await tx.contractor.count({ where: { id: { in: ids } } })) !== ids.length) biz('Подрядчик не найден');
      const newTitle = r2(Number(p.titleM2) || 0);
      if (newTitle <= 0) biz('Укажите объём выполнения');
      const others = await this.allocated(tx, objectId, exId);
      const objTitle = n(obj!.titleM2);
      if (others + newTitle > objTitle + 1e-9) {
        biz(`Объём выполнений превысит объём объекта: ${fmt(others)} + ${fmt(newTitle)} > ${fmt(objTitle)} м². Доступно: ${fmt(objTitle - others)} м²`);
      }
      const dup = await tx.execution.findFirst({ where: { objectId, number: p.number, ...(exId ? { id: { not: exId } } : {}) } });
      if (dup) biz(`Выполнение №${p.number} уже есть на объекте`);
      const base = { number: p.number, name: p.name, periodFrom: new Date(p.periodFrom), periodTo: new Date(p.periodTo) };
      if (base.periodTo < base.periodFrom) biz('Дата окончания раньше даты начала');

      if (!exId) {
        const ex = await tx.execution.create({
          data: { ...base, objectId, titleM2: newTitle, createdById: u.id, contractors: { create: ids.map((contractorId) => ({ contractorId })) } },
        });
        await hist(tx, { userId: u.id, action: `Выполнение создано, объём ${fmt(newTitle)} м²`, executionId: ex.id });
        return { id: ex.id, message: 'Выполнение создано' };
      }

      await lockEx(tx, exId);
      const ex = await loadEx(tx, exId);
      if (ex.objectId !== objectId) notFound('Выполнение не найдено');
      const hasForms = ex.forms.some((f) => f.status !== 'DRAFT');
      const changed = [...ids].sort().join() !== [...contractorIdsOf(ex)].sort().join();
      if (changed && hasForms) biz('Состав подрядчиков можно менять, пока нет поданных форм');
      if (newTitle !== n(ex.titleM2)) await this.changeTitle(tx, u, ex.id, newTitle, reason);
      await tx.execution.update({ where: { id: ex.id }, data: base });
      if (changed) {
        await tx.executionContractor.deleteMany({ where: { executionId: ex.id } });
        await tx.executionContractor.createMany({ data: ids.map((contractorId) => ({ executionId: ex.id, contractorId })) });
        // черновики снятых подрядчиков удаляем
        await tx.contractorForm.deleteMany({ where: { executionId: ex.id, contractorId: { notIn: ids } } });
      }
      return { id: ex.id, message: 'Выполнение сохранено' };
    });
  }

  /**
   * Изменение титула в ходе согласования: все поданные формы (в т.ч. одобренные заказчиком)
   * получают статус «Изменён титул», акт уходит на доработку, всё пишется в журнал и рассылается.
   */
  private async changeTitle(tx: Tx, u: AuthUser, exId: string, newTitle: number, reason: string) {
    const ex = await loadEx(tx, exId);
    if (actFinal(ex.act?.status)) biz('Акт уже согласован — титул изменить нельзя. Используйте «Корректировку» в карточке акта.');
    const old = n(ex.titleM2);
    const inFlow = ex.forms.some((f) => f.status !== 'DRAFT');
    if (inFlow && !reason.trim()) biz('Укажите причину изменения титула — по выполнению уже идёт согласование');
    await tx.execution.update({ where: { id: ex.id }, data: { titleM2: newTitle } });
    await tx.titleChange.create({ data: { executionId: ex.id, fromM2: old, toM2: newTitle, reason: reason || '', duringApproval: inFlow, userId: u.id } });
    await hist(tx, {
      userId: u.id, action: `Изменён титульный объём: ${fmt(old)} → ${fmt(newTitle)} м²`, comment: reason || null, highlight: inFlow,
      executionId: ex.id, meta: { from: old, to: newTitle },
    });
    if (!inFlow) return;

    const { label, link, rel } = exLabel(ex);
    const affected: string[] = [];
    for (const f of ex.forms.filter((x) => x.status !== 'DRAFT')) {
      await tx.contractorForm.update({ where: { id: f.id }, data: { status: 'TITLE_CHANGED', autoZero: false } });
      await hist(tx, {
        userId: u.id, formId: f.id, comment: reason, highlight: true,
        action: `Изменён титул ${fmt(old)} → ${fmt(newTitle)} м² — форма возвращена на пересчёт (была: ${f.status === 'APPROVED_BY_CLIENT' ? 'одобрена заказчиком' : 'подана'})`,
      });
      affected.push(f.contractorId);
    }
    if (ex.act && ['ON_CHECK_CLIENT', 'IN_REVISION', 'ON_CHECK_GC'].includes(ex.act.status)) {
      await setActStatus(tx, ex.act.id, 'IN_REVISION', u.id, `Изменён титул ${fmt(old)} → ${fmt(newTitle)} м² — акт возвращён на пересчёт, одобрения заказчика сняты`, { comment: reason, highlight: true });
      await syncActRows(tx, ex.act.id, ex.id);
    }
    await touch(tx, ex.id);
    const msg = `Изменён титул по ${label}: ${fmt(old)} → ${fmt(newTitle)} м². Формы возвращены на пересчёт.`;
    await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, affected), `${msg} Проверьте объёмы и подайте форму заново.`, link, { kind: 'ACTION', ...rel });
    await this.notifier.notify(tx, await this.notifier.clientUserIds(tx, ex.object.clientId), `${msg} Акт вернётся к вам после пересчёта.`,
      ex.act ? `/acts/${ex.act.id}` : link, { kind: 'IMPORTANT', ...rel, actId: ex.act?.id });
    await this.notifier.notify(tx, await this.notifier.staffIds(tx), msg, link, { kind: 'IMPORTANT', ...rel });
  }

  async deleteExecution(u: AuthUser, exId: string) {
    const files = await this.prisma.$transaction(async (tx) => {
      await lockEx(tx, exId);
      const ex = await loadEx(tx, exId);
      this.manager(u, ex.object);
      await this.deletable(tx, exId);
      const files = await this.filesOf(tx, [exId]);
      const hadForms = ex.forms.length > 0;
      const { label } = exLabel(ex);
      await tx.execution.delete({ where: { id: exId } });
      await tx.storedFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
      const msg = `${u.name} удалил ${label}`;
      const link = `/objects/${ex.objectId}`;
      if (hadForms) await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, contractorIdsOf(ex)), msg, link, { kind: 'IMPORTANT', objectId: ex.objectId });
      const to = [...(await this.notifier.staffIds(tx)), ...(await this.notifier.clientUserIds(tx, ex.object.clientId))].filter((x) => x !== u.id);
      await this.notifier.notify(tx, to, msg, link, { kind: 'IMPORTANT', objectId: ex.objectId });
      return files;
    });
    await this.purgeFiles(files);
    return { message: 'Выполнение удалено' };
  }

  // ---------------- Чат и уведомления ----------------

  async canSeeObject(u: AuthUser, objectId: string) {
    const obj = await this.prisma.siteObject.findUnique({ where: { id: objectId }, select: { clientId: true } });
    if (!obj) return false;
    if (u.role === 'GC' || u.role === 'MANAGER') return true;
    if (u.role === 'CLIENT') return obj.clientId === u.clientId;
    return (await this.prisma.executionContractor.count({ where: { contractorId: u.contractorId ?? '', execution: { objectId } } })) > 0;
  }

  async sendChat(u: AuthUser, objectId: string, text: string) {
    if (!text.trim()) biz('Пустое сообщение');
    if (!(await this.canSeeObject(u, objectId))) forbid();
    await this.prisma.chatMessage.create({ data: { objectId, userId: u.id, text: text.trim().slice(0, 4000) } });
    return { message: '' };
  }

  async markRead(u: AuthUser, ids: string[] | 'all') {
    const r = await this.prisma.notification.updateMany({
      where: { userId: u.id, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
    return { message: '', count: r.count };
  }
}
