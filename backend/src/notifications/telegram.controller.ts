import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { TelegramService } from './telegram.service';

@Controller()
export class TelegramController {
  constructor(private tg: TelegramService) {}

  /** Одноразовый код привязки Telegram для личного кабинета. */
  @Post('me/telegram-code') @HttpCode(200)
  code(@CurrentUser() u: AuthUser) { return this.tg.createLinkCode(u.id); }

  @Post('me/telegram-unlink') @HttpCode(200)
  async unlink(@CurrentUser() u: AuthUser) {
    await this.tg.unlink(u.id);
    return { message: 'Telegram отвязан' };
  }

  /** Webhook бота: setWebhook(url, secret_token=TELEGRAM_WEBHOOK_SECRET). */
  @Public() @Post('telegram/webhook') @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string, @Body() update: any) {
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) throw new ForbiddenException();
    const reply = await this.tg.handleUpdate(update);
    // Ответ прямо в webhook — Telegram отправит его как sendMessage
    return reply ? { method: 'sendMessage', chat_id: update.message.chat.id, text: reply } : {};
  }
}
