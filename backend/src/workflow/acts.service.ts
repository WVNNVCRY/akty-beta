import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthUser, isStaff } from '../common/auth';
import { biz, forbid, notFound } from '../common/errors';
import { makeEmptyDocx } from '../files/demo-files';
import { StorageService } from '../files/storage.service';
import { NotifyService } from '../notifications/notify.service';
import { PrismaService } from '../prisma.service';
import { Tx, actFinal, buildLines, contractorIdsOf, contractorNames, exLabel, fmt, hist, loadEx, lockEx, n, r2, setActStatus, syncActRows, touch } from './helpers';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@Injectable()
export class ActsService {
  constructor(private prisma: PrismaService, private notifier: NotifyService, private storage: StorageService) {}

  /** Найти акт, заблокировать его выполнение, вернуть всё нужное. */
  private async withAct<T>(actId: string, fn: (tx: Tx, act: NonNullable<Awaited<ReturnType<typeof loadEx>>['act']>, ex: Awaited<ReturnType<typeof loadEx>>) => Promise<T>) {
    const a = await this.prisma.act.findUnique({ where: { id: actId }, select: { executionId: true } });
    if (!a) notFound('Акт не найден');
    return this.prisma.$transaction(async (tx) => {
      await lockEx(tx, a!.executionId);
      const ex = await loadEx(tx, a!.executionId);
      return fn(tx, ex.act!, ex);
    });
  }

  async gcApprove(u: AuthUser, actId: string) {
    if (!isStaff(u.role)) forbid();
    return this.withAct(actId, async (tx, act, ex) => {
      if (act.status !== 'ON_CHECK_GC') biz('Акт не на проверке ГП');
      const { label, rel } = exLabel(ex);
      await tx.act.update({ where: { id: act.id }, data: { approvedAt: new Date() } });
      await setActStatus(tx, act.id, 'APPROVED', u.id, 'Акт согласован генподрядчиком');
      await touch(tx, ex.id);
      await this.notifier.notify(tx,
        [...(await this.notifier.contractorUserIds(tx, contractorIdsOf(ex))), ...(await this.notifier.clientUserIds(tx, ex.object.clientId))],
        `Акт ${act.number} согласован: ${label}`, `/acts/${act.id}`, { kind: 'INFO', ...rel, actId: act.id });
      return { message: 'Акт согласован' };
    });
  }

  /** ГП возвращает акт: выбранные формы уходят подрядчикам, после исправления — снова к заказчику. */
  async gcReturn(u: AuthUser, actId: string, contractorIds: string[], comment: string) {
    if (!isStaff(u.role)) forbid();
    if (!comment.trim()) biz('Укажите комментарий');
    if (!contractorIds.length) biz('Выберите хотя бы одного подрядчика');
    return this.withAct(actId, async (tx, act, ex) => {
      if (act.status !== 'ON_CHECK_GC') biz('Акт не на проверке ГП');
      const { label, link, rel } = exLabel(ex);
      const nameOf = await contractorNames(tx, contractorIds);
      const names = contractorIds.map(nameOf).join(', ');
      for (const f of ex.forms.filter((x) => contractorIds.includes(x.contractorId))) {
        await tx.contractorForm.update({ where: { id: f.id }, data: { status: 'REJECTED_BY_GC', autoZero: false } });
        await hist(tx, { userId: u.id, action: 'Возвращена генподрядчиком', comment, hiddenFromClient: true, visibleToContractorId: f.contractorId, formId: f.id });
      }
      await setActStatus(tx, act.id, 'IN_REVISION', u.id, `Акт возвращён ГП на доработку: ${names}`, { comment, hiddenFromClient: true });
      await syncActRows(tx, act.id, ex.id);
      await touch(tx, ex.id);
      await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, contractorIds), `Генподрядчик вернул форму (${label}): ${comment}`, link, { kind: 'ACTION', ...rel });
      await this.notifier.notify(tx, await this.notifier.clientUserIds(tx, ex.object.clientId),
        `Акт ${act.number} возвращён на доработку подрядчикам: ${label}`, `/acts/${act.id}`, { kind: 'INFO', ...rel, actId: act.id });
      return { message: 'Акт возвращён на доработку' };
    });
  }

  /** Сформировать Word (пока пустой бланк), сохранить в хранилище, записать в журнал. */
  async word(u: AuthUser, actId: string): Promise<{ name: string; body: Buffer }> {
    if (!(isStaff(u.role) || u.role === 'CLIENT')) forbid();
    const old = await this.withAct(actId, async (tx, act, ex) => {
      if (u.role === 'CLIENT' && ex.object.clientId !== u.clientId) forbid();
      if (!actFinal(act.status)) biz('Word доступен только для согласованного акта');
      return act;
    });
    const body = await makeEmptyDocx();
    const name = `${old.number}.docx`;
    const key = `acts/${old.id}/${randomUUID()}.docx`;
    await this.storage.put(key, body, DOCX);
    const prevFile = old.wordFileId ? await this.prisma.storedFile.findUnique({ where: { id: old.wordFileId } }) : null;
    await this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.create({
        data: { kind: 'WORD_ACT', bucket: this.storage.bucket, key, originalName: name, mimeType: DOCX, size: BigInt(body.length), uploadedById: u.id },
      });
      await tx.act.update({ where: { id: old.id }, data: { wordFileId: file.id, wordGeneratedAt: new Date() } });
      if (prevFile) await tx.storedFile.delete({ where: { id: prevFile.id } });
      await hist(tx, { userId: u.id, action: 'Выгружен акт в формате Word (шаблон пока пустой)', actId: old.id });
    });
    if (prevFile) await this.storage.remove(prevFile.key, prevFile.bucket);
    return { name, body };
  }

  async archive(u: AuthUser, actIds: string[]) {
    if (!isStaff(u.role)) forbid();
    for (const id of actIds) {
      await this.withAct(id, async (tx, act) => {
        if (act.status !== 'APPROVED') biz(`Акт ${act.number}: в архив можно перевести только согласованный акт`);
        await tx.act.update({ where: { id: act.id }, data: { archivedAt: new Date() } });
        await setActStatus(tx, act.id, 'ARCHIVED', u.id, 'Акт переведён в архив');
      });
    }
    return { message: actIds.length > 1 ? 'Акты отправлены в архив' : 'Акт отправлен в архив' };
  }

  /** Корректировка после согласования — только ГП, с обязательной причиной. Пишется в журнал с подсветкой. */
  async correct(u: AuthUser, actId: string, rows: { contractorId: string; lines: { markingTypeId: string; linearM: number }[] }[], reason: string) {
    if (u.role !== 'GC') forbid('Корректировка после согласования доступна только генподрядчику');
    if (!reason.trim()) biz('Укажите причину корректировки');
    return this.withAct(actId, async (tx, act, ex) => {
      if (!actFinal(act.status)) biz('Корректировка доступна только для согласованных актов');
      const current = await tx.actRow.findMany({ where: { actId: act.id }, include: { lines: true } });
      const nameOf = await contractorNames(tx, current.map((r) => r.contractorId));
      const changes: string[] = [];
      let actTotal = 0;
      for (const row of current) {
        const patch = rows.find((r) => r.contractorId === row.contractorId);
        const merged = new Map(row.lines.map((l) => [l.markingTypeId, n(l.linearM)]));
        const { codeOf } = await buildLines(tx, []);
        for (const l of patch?.lines || []) {
          const oldV = merged.get(l.markingTypeId) || 0;
          if (r2(oldV) !== r2(l.linearM)) {
            changes.push(`${nameOf(row.contractorId)}, ${codeOf(l.markingTypeId)}: ${fmt(oldV)} → ${fmt(l.linearM)} п.м`);
            merged.set(l.markingTypeId, r2(l.linearM));
          }
        }
        // старые строки сохраняют свои коэффициенты, новые берут текущие из справочника
        const fresh = await buildLines(tx, [...merged.entries()].filter(([, v]) => v > 0).map(([markingTypeId, linearM]) => ({ markingTypeId, linearM })));
        const lines = fresh.lines.map((l) => {
          const old = row.lines.find((x) => x.markingTypeId === l.markingTypeId);
          return old ? { ...l, widthM: old.widthM, fillRatio: old.fillRatio, areaM2: r2(l.linearM * n(old.widthM) * n(old.fillRatio)) } : l;
        });
        const total = r2(lines.reduce((s, l) => s + l.areaM2, 0));
        actTotal += total;
        await tx.actRowLine.deleteMany({ where: { rowId: row.id } });
        await tx.actRow.update({ where: { id: row.id }, data: { totalM2: total, lines: { create: lines } } });
        const form = ex.forms.find((f) => f.contractorId === row.contractorId);
        if (form) {
          await tx.formLine.deleteMany({ where: { formId: form.id } });
          await tx.contractorForm.update({ where: { id: form.id }, data: { totalM2: total, lines: { create: lines } } });
        }
      }
      if (!changes.length) biz('Изменений нет');
      await tx.act.update({ where: { id: act.id }, data: { totalM2: r2(actTotal) } });
      await hist(tx, { userId: u.id, action: `Корректировка ГП: ${changes.join('; ')}`, comment: reason, highlight: true, actId: act.id });
      return { message: 'Корректировка сохранена и записана в журнал' };
    });
  }
}
