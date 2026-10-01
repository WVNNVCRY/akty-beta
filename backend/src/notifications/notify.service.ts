import { Injectable } from '@nestjs/common';
import { NotificationKind, Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface NotifyMeta {
  kind: NotificationKind;
  /** Для группировки в ленте: объект/выполнение/акт */
  objectId?: string | null;
  executionId?: string | null;
  actId?: string | null;
  /** Не создавать повторно (напоминания, дайджесты) */
  dedupeKey?: string | null;
}

/**
 * Уведомления в системе + постановка в очередь Telegram.
 * Telegram получают подрядчики, GC и MANAGER с привязанным chatId; заказчик — позже (п. 8 ТЗ).
 */
@Injectable()
export class NotifyService {
  async notify(tx: Tx, userIds: string[], text: string, link: string | null, meta: NotifyMeta) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const users = await tx.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, role: true, telegramChatId: true } });
    await tx.notification.createMany({
      data: users.map((u) => ({
        userId: u.id, text, link, kind: meta.kind,
        objectId: meta.objectId ?? null, executionId: meta.executionId ?? null, actId: meta.actId ?? null,
        dedupeKey: meta.dedupeKey ?? null,
        telegram: u.telegramChatId && u.role !== 'CLIENT' ? 'PENDING' : 'NONE',
      })),
      skipDuplicates: true, // dedupeKey
    });
  }

  staffIds = async (tx: Tx) =>
    (await tx.user.findMany({ where: { active: true, role: { in: ['GC', 'MANAGER'] } }, select: { id: true } })).map((u) => u.id);

  contractorUserIds = async (tx: Tx, contractorIds: string[]) =>
    contractorIds.length
      ? (await tx.user.findMany({ where: { active: true, role: 'CONTRACTOR', contractorId: { in: contractorIds } }, select: { id: true } })).map((u) => u.id)
      : [];

  clientUserIds = async (tx: Tx, clientId: string) =>
    (await tx.user.findMany({ where: { active: true, role: 'CLIENT', clientId }, select: { id: true } })).map((u) => u.id);
}
