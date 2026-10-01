import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, ForbiddenException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/** Ошибка бизнес-правила — текст показывается пользователю как есть. */
export const biz = (message: string): never => { throw new BadRequestException(message); };
export const forbid = (message = 'Нет прав'): never => { throw new ForbiddenException(message); };
export const notFound = (message: string): never => { throw new NotFoundException(message); };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('API');
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let message = 'Внутренняя ошибка сервера';
    if (e instanceof HttpException) {
      status = e.getStatus();
      const r: any = e.getResponse();
      message = typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join('; ') : r?.message || e.message;
    } else if (e instanceof ZodError) {
      status = 400;
      message = 'Некорректные данные: ' + e.issues.map((i) => `${i.path.join('.') || 'тело'} — ${i.message}`).join('; ');
    } else if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') { status = 409; message = 'Запись с такими данными уже существует'; }
      else if (e.code === 'P2003') { status = 409; message = 'Запись используется в других данных — удаление невозможно'; }
      else if (e.code === 'P2025') { status = 404; message = 'Запись не найдена'; }
      else this.log.error(e);
    } else {
      this.log.error(e?.stack || e);
    }
    res.status(status).json({ statusCode: status, message });
  }
}
