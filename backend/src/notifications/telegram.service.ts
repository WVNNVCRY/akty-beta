import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';

/**
 * Telegram-бот (один на систему). Без TELEGRAM_BOT_TOKEN уведомления остаются в статусе PENDING
 * и видны только в системе. С токеном — отправка каждые 15 с (на этапе 3 заменяется на BullMQ).
 * Привязка: пользователь получает одноразовый код в личном кабинете и отправляет боту «/start КОД».
 */
@Injectable()
export class TelegramService {
  private log = new Logger('Telegram');
  private token = process.env.TELEGRAM_BOT_TOKEN || '';
  private busy = false;

  constructor(private prisma: PrismaService) {}

  get enabled() { return !!this.token; }

  async createLinkCode(userId: string) {
    const token = randomBytes(5).toString('hex').toUpperCase();
    await this.prisma.telegramLinkToken.create({ data: { token, userId, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { code: token, expiresInMin: 15, botEnabled: this.enabled };
  }

  async unlink(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkedAt: null } });
  }

  /** Обработка апдейта бота (webhook или getUpdates): «/start КОД» → привязка chatId. */
  async handleUpdate(update: any): Promise<string | null> {
    const msg = update?.message;
    const text: string = msg?.text || '';
    const chatId = msg?.chat?.id ? String(msg.chat.id) : null;
    const m = text.match(/^\/start\s+([A-F0-9]{10})$/i);
    if (!chatId || !m) return null;
    const t = await this.prisma.telegramLinkToken.findUnique({ where: { token: m[1].toUpperCase() } });
    if (!t || t.usedAt || t.expiresAt < new Date()) return 'Код недействителен или истёк. Получите новый в личном кабинете.';
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null, telegramLinkedAt: null } }),
      this.prisma.user.update({ where: { id: t.userId }, data: { telegramChatId: chatId, telegramLinkedAt: new Date() } }),
      this.prisma.telegramLinkToken.update({ where: { token: t.token }, data: { usedAt: new Date() } }),
    ]);
    return 'Telegram привязан. Уведомления будут приходить сюда.';
  }

  @Interval(15_000)
  async flush() {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    try {
      const batch = await this.prisma.notification.findMany({
        where: { telegram: 'PENDING' }, take: 25, orderBy: { createdAt: 'asc' },
        include: { user: { select: { telegramChatId: true } } },
      });
      for (const n of batch) {
        if (!n.user.telegramChatId) { await this.prisma.notification.update({ where: { id: n.id }, data: { telegram: 'NONE' } }); continue; }
        try {
          const r = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: n.user.telegramChatId, text: n.text }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
          await this.prisma.notification.update({ where: { id: n.id }, data: { telegram: 'SENT', telegramSentAt: new Date() } });
        } catch (e: any) {
          this.log.warn(`Не отправлено ${n.id}: ${e.message}`);
          await this.prisma.notification.update({ where: { id: n.id }, data: { telegram: 'FAILED', telegramError: String(e.message).slice(0, 500) } });
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
