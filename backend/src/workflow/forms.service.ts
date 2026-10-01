import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common/auth';
import { biz, forbid, notFound } from '../common/errors';
import { NotifyService } from '../notifications/notify.service';
import { PrismaService } from '../prisma.service';
import {
  COUNTED, EDITABLE, Tx, actLocked, actToRevision, balance, buildLines, contractorIdsOf, contractorNames, exLabel, fmt,
  getSettings, hist, isComplete, loadEx, lockEx, n, setActStatus, shortage, syncActRows, touch,
} from './helpers';

export interface FormInput {
  lines: { markingTypeId: string; linearM: number }[];
  /** undefined — не менять, null — убрать файл */
  schemeFileId?: string | null;
  photoFileId?: string | null;
}

/**
 * Поток: подрядчики заполняют формы → сумма = титул → формы и акт уходят заказчику →
 * заказчик одобряет/отклоняет каждую форму → все одобрены → акт у ГП (ActsService).
 */
@Injectable()
export class FormsService {
  constructor(private prisma: PrismaService, private notifier: NotifyService) {}

  private formExId = async (formId: string) =>
    (await this.prisma.contractorForm.findUnique({ where: { id: formId }, select: { executionId: true } }))?.executionId ?? notFound('Форма не найдена');

  // ---------------- Подрядчик ----------------

  /** Сохранить черновик и (опционально) сразу подать — одной транзакцией. */
  async save(u: AuthUser, exId: string, input: FormInput, submit: boolean): Promise<{ formId: string; message: string }> {
    return this.prisma.$transaction(async (tx) => {
      await lockEx(tx, exId);
      const formId = await this.saveDraft(tx, u, exId, input);
      const message = submit ? await this.submitIn(tx, u, formId) : 'Черновик сохранён';
      return { formId, message };
    });
  }

  private async checkFile(tx: Tx, u: AuthUser, fileId: string | null | undefined, kind: 'SCHEME' | 'PHOTO', current: string | null) {
    if (fileId === undefined || fileId === null || fileId === current) return;
    const f = await tx.storedFile.findUnique({ where: { id: fileId } });
    if (!f || f.kind !== kind || f.uploadedById !== u.id) biz('Файл не найден или загружен другим пользователем');
  }

  private async saveDraft(tx: Tx, u: AuthUser, exId: string, input: FormInput): Promise<string> {
    if (u.role !== 'CONTRACTOR' || !u.contractorId) forbid('Заполнять форму может только подрядчик');
    const ex = await loadEx(tx, exId);
    if (!contractorIdsOf(ex).includes(u.contractorId!)) forbid('Вы не назначены на это выполнение');
    if (actLocked(ex.act?.status)) biz('Акт уже у генподрядчика или согласован — редактирование недоступно');
    let form = ex.forms.find((f) => f.contractorId === u.contractorId);
    if (form && !EDITABLE.includes(form.status)) biz('Форма подана. Чтобы изменить её, сначала отзовите.');
    await this.checkFile(tx, u, input.schemeFileId, 'SCHEME', form?.schemeFileId ?? null);
    await this.checkFile(tx, u, input.photoFileId, 'PHOTO', form?.photoFileId ?? null);
    const { lines, total } = await buildLines(tx, input.lines);
    if (!form) {
      const created = await tx.contractorForm.create({ data: { executionId: exId, contractorId: u.contractorId! } });
      await hist(tx, { userId: u.id, action: 'Форма создана', formId: created.id });
      form = { ...created, lines: [] };
    }
    await tx.formLine.deleteMany({ where: { formId: form.id } });
    await tx.contractorForm.update({
      where: { id: form.id },
      data: {
        totalM2: total, autoZero: false,
        ...(input.schemeFileId !== undefined ? { schemeFileId: input.schemeFileId } : {}),
        ...(input.photoFileId !== undefined ? { photoFileId: input.photoFileId } : {}),
        lines: { create: lines },
      },
    });
    return form.id;
  }

  private async submitIn(tx: Tx, u: AuthUser, formId: string): Promise<string> {
    const form = await tx.contractorForm.findUnique({ where: { id: formId }, include: { lines: true } });
    if (!form) notFound('Форма не найдена');
    if (u.contractorId !== form!.contractorId) forbid('Это не ваша форма');
    if (!EDITABLE.includes(form!.status)) biz('Форма уже подана');
    const ex = await loadEx(tx, form!.executionId);
    if (actLocked(ex.act?.status)) biz('Акт уже у генподрядчика или согласован');
    if (!form!.lines.some((l) => n(l.linearM) > 0)) biz('Не введён ни один объём');
    if (!form!.schemeFileId) biz('Не загружена PDF-схема');
    if (!form!.photoFileId) biz('Не загружено PDF-фото');
    const s = await getSettings(tx);
    const tol = n(s.toleranceM2);
    const bal = balance(ex, { formId: form!.id, totalM2: n(form!.totalM2) });
    if (bal.diff > tol + 1e-9) {
      biz(`Превышение титула на ${fmt(bal.diff)} м² (титул ${fmt(bal.title)} м², с вашей формой ${fmt(bal.submitted)} м²). Уменьшите объём.`);
    }
    await tx.contractorForm.update({ where: { id: form!.id }, data: { status: 'WAITING_PARTNER', autoZero: false, submittedAt: new Date() } });
    await hist(tx, { userId: u.id, action: `Форма подана: ${fmt(n(form!.totalM2))} м²`, formId: form!.id });
    await touch(tx, ex.id);
    if (await this.advance(tx, ex.id)) return 'Объёмы сошлись с титулом — формы отправлены заказчику.';
    const { label, link, rel } = exLabel(ex);
    const name = await contractorNames(tx, [form!.contractorId]);
    const partners = contractorIdsOf(ex).filter((c) => c !== form!.contractorId);
    await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, partners),
      `${name(form!.contractorId)} подал форму (${label}). Недостача до титула: ${fmt(shortage(bal))} м²`, link, { kind: 'ACTION', ...rel });
    return `Форма принята, статус «Ожидание партнёра». Недостача до титула: ${fmt(shortage(bal))} м².`;
  }

  /**
   * Если сумма поданных форм = титулу: остальные подрядчики получают автоформы с нулями,
   * все ожидающие формы уходят заказчику, акт создаётся / возвращается к заказчику.
   */
  async advance(tx: Tx, exId: string): Promise<boolean> {
    let ex = await loadEx(tx, exId);
    const s = await getSettings(tx);
    if (!isComplete(balance(ex), n(s.toleranceM2))) return false;
    const { label, link, rel } = exLabel(ex);

    // Автоотправка нулевых форм
    for (const cid of contractorIdsOf(ex)) {
      let f = ex.forms.find((x) => x.contractorId === cid);
      if (f && COUNTED.includes(f.status)) continue;
      const hadData = !!f?.lines.some((l) => n(l.linearM) > 0);
      if (!f) f = { ...(await tx.contractorForm.create({ data: { executionId: ex.id, contractorId: cid } })), lines: [] };
      await tx.formLine.deleteMany({ where: { formId: f.id } });
      await tx.contractorForm.update({
        where: { id: f.id },
        data: { totalM2: 0, schemeFileId: null, photoFileId: null, autoZero: true, status: 'WAITING_PARTNER', submittedAt: new Date() },
      });
      await hist(tx, {
        action: 'Отправлена автоматически с нулевым объёмом: весь объём выбран другими подрядчиками', formId: f.id, highlight: true,
        comment: hadData ? 'Данные черновика сброшены. Если вы выполняли работы — отзовите форму и согласуйте объёмы с партнёром.' : null,
      });
      await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, [cid]),
        `Весь объём по ${label} выбран другим подрядчиком — ваша форма отправлена автоматически с нулями`, link, { kind: 'IMPORTANT', ...rel });
    }

    const waiting = await tx.contractorForm.findMany({ where: { executionId: ex.id, status: 'WAITING_PARTNER' }, select: { id: true } });
    for (const f of waiting) {
      await tx.contractorForm.update({ where: { id: f.id }, data: { status: 'ON_CHECK_CLIENT' } });
      await hist(tx, { action: 'Объёмы сошлись с титулом — форма направлена заказчику', formId: f.id });
    }

    let act = ex.act;
    if (!act) {
      const st = await tx.settings.update({ where: { id: 1 }, data: { actCounter: { increment: 1 } } });
      act = await tx.act.create({
        data: { number: `АСР-${String(st.actCounter).padStart(4, '0')}`, executionId: ex.id, objectId: ex.objectId, status: 'ON_CHECK_CLIENT', totalM2: 0 },
      });
      await hist(tx, { action: 'Объёмы сошлись с титулом — акт создан и направлен заказчику', actId: act.id });
    } else if (act.status === 'IN_REVISION') {
      act = await tx.act.update({ where: { id: act.id }, data: { round: { increment: 1 } } });
      await setActStatus(tx, act.id, 'ON_CHECK_CLIENT', null, `Формы исправлены — акт повторно направлен заказчику (редакция ${act.round})`);
    }
    // Пересчёт после изменения титула выполнен
    await tx.titleChange.updateMany({ where: { executionId: ex.id, duringApproval: true, resolvedAt: null }, data: { resolvedAt: new Date() } });
    await syncActRows(tx, act.id, ex.id);
    const actLink = `/acts/${act.id}`;
    await this.notifier.notify(tx, await this.notifier.clientUserIds(tx, ex.object.clientId), `Акт ${act.number} на согласование: ${label}`, actLink, { kind: 'ACTION', ...rel, actId: act.id });
    await this.notifier.notify(tx, await this.notifier.staffIds(tx), `Акт ${act.number} направлен заказчику: ${label}`, actLink, { kind: 'INFO', ...rel, actId: act.id });
    ex = await loadEx(tx, exId);
    await this.maybeToGc(tx, ex.id);
    return true;
  }

  async withdraw(u: AuthUser, formId: string) {
    const exId = await this.formExId(formId);
    return this.prisma.$transaction(async (tx) => {
      await lockEx(tx, exId);
      const ex = await loadEx(tx, exId);
      const form = ex.forms.find((f) => f.id === formId)!;
      if (u.contractorId !== form.contractorId) forbid('Это не ваша форма');
      if (!COUNTED.includes(form.status)) biz('Эту форму нельзя отозвать');
      if (actLocked(ex.act?.status)) biz('Акт уже у генподрядчика или согласован — отзыв невозможен');
      const wasApproved = form.status === 'APPROVED_BY_CLIENT';
      const nameOf = await contractorNames(tx, contractorIdsOf(ex));
      const name = nameOf(form.contractorId);
      const { label, link, rel } = exLabel(ex);
      await tx.contractorForm.update({ where: { id: form.id }, data: { status: 'DRAFT', autoZero: false } });
      await hist(tx, { userId: u.id, action: wasApproved ? 'Форма отозвана после одобрения заказчиком' : 'Форма отозвана', formId: form.id, highlight: wasApproved });
      // автоформы с нулями были созданы из-за этой формы — сбрасываем их тоже
      for (const x of ex.forms.filter((f) => f.id !== form.id && f.autoZero && COUNTED.includes(f.status))) {
        await tx.contractorForm.update({ where: { id: x.id }, data: { status: 'DRAFT', autoZero: false } });
        await hist(tx, { action: `Автоформа с нулями сброшена: ${name} отозвал свою форму`, formId: x.id });
        await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, [x.contractorId]),
          `${name} отозвал форму (${label}) — ваша автоформа с нулями сброшена, объём снова открыт`, link, { kind: 'ACTION', ...rel });
      }
      await actToRevision(tx, ex, u.id, `${name} отозвал форму — акт на доработке`);
      await touch(tx, ex.id);
      if (wasApproved) {
        await this.notifier.notify(tx, [...(await this.notifier.staffIds(tx)), ...(await this.notifier.clientUserIds(tx, ex.object.clientId))],
          `${name} отозвал форму после одобрения заказчиком: ${label}`, link, { kind: 'IMPORTANT', ...rel });
      }
      return { message: 'Форма отозвана' };
    });
  }

  // ---------------- Заказчик (по формам) ----------------

  private clientCheck(u: AuthUser, clientId: string, status: string) {
    if (u.role !== 'CLIENT' || u.clientId !== clientId) forbid('Согласовывать формы может только заказчик объекта');
    if (status !== 'ON_CHECK_CLIENT') biz('Форма не на проверке заказчика');
  }

  async clientApprove(u: AuthUser, formId: string) {
    const exId = await this.formExId(formId);
    return this.prisma.$transaction(async (tx) => {
      await lockEx(tx, exId);
      const ex = await loadEx(tx, exId);
      const form = ex.forms.find((f) => f.id === formId)!;
      this.clientCheck(u, ex.object.clientId, form.status);
      await tx.contractorForm.update({ where: { id: form.id }, data: { status: 'APPROVED_BY_CLIENT' } });
      await hist(tx, { userId: u.id, action: 'Одобрена заказчиком', formId: form.id });
      await touch(tx, ex.id);
      await this.maybeToGc(tx, ex.id);
      return { message: 'Форма одобрена' };
    });
  }

  async clientReject(u: AuthUser, formId: string, comment: string) {
    if (!comment.trim()) biz('Укажите комментарий');
    const exId = await this.formExId(formId);
    return this.prisma.$transaction(async (tx) => {
      await lockEx(tx, exId);
      const ex = await loadEx(tx, exId);
      const form = ex.forms.find((f) => f.id === formId)!;
      this.clientCheck(u, ex.object.clientId, form.status);
      const name = (await contractorNames(tx, [form.contractorId]))(form.contractorId);
      const { label, link, rel } = exLabel(ex);
      await tx.contractorForm.update({ where: { id: form.id }, data: { status: 'REJECTED_BY_CLIENT' } });
      await hist(tx, { userId: u.id, action: 'Отклонена заказчиком', comment, formId: form.id });
      await actToRevision(tx, ex, u.id, `Заказчик отклонил форму: ${name}`, { comment });
      await touch(tx, ex.id);
      await this.notifier.notify(tx, await this.notifier.contractorUserIds(tx, [form.contractorId]), `Форма отклонена заказчиком (${label}): ${comment}`, link, { kind: 'ACTION', ...rel });
      await this.notifier.notify(tx, await this.notifier.staffIds(tx), `Заказчик отклонил форму ${name} (${label}): ${comment}`, link, { kind: 'IMPORTANT', ...rel });
      return { message: 'Форма отклонена и возвращена подрядчику' };
    });
  }

  /** Все формы одобрены заказчиком и сумма = титул → акт уходит ГП. */
  async maybeToGc(tx: Tx, exId: string) {
    const ex = await loadEx(tx, exId);
    if (!ex.act || ex.act.status !== 'ON_CHECK_CLIENT') return;
    const forms = contractorIdsOf(ex).map((c) => ex.forms.find((f) => f.contractorId === c));
    if (!forms.every((f) => f && f.status === 'APPROVED_BY_CLIENT')) return;
    const s = await getSettings(tx);
    if (!isComplete(balance(ex), n(s.toleranceM2))) return;
    await syncActRows(tx, ex.act.id, ex.id);
    await setActStatus(tx, ex.act.id, 'ON_CHECK_GC', null, 'Заказчик одобрил все формы — акт направлен генподрядчику');
    const { label, rel } = exLabel(ex);
    await this.notifier.notify(tx, await this.notifier.staffIds(tx),
      `Заказчик одобрил все формы, акт ${ex.act.number} ждёт проверки ГП: ${label}`, `/acts/${ex.act.id}`, { kind: 'ACTION', ...rel, actId: ex.act.id });
  }
}
