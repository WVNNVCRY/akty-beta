import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { nonneg, num, parse, uuid, z } from '../common/zod';
import { PrismaService } from '../prisma.service';
import { StateService } from '../state/state.service';
import { notFound } from '../common/errors';
import { ActsService } from './acts.service';
import { FormsService } from './forms.service';
import { ObjectsService } from './objects.service';

const Id = new ParseUUIDPipe({ version: '4', exceptionFactory: () => notFound('Не найдено') });
const lineSchema = z.object({ markingTypeId: uuid, linearM: nonneg });
const objectSchema = z.object({
  excelRowNumber: z.coerce.number().int().positive(), name: z.string().trim().min(1), address: z.string().trim().default(''),
  district: z.string().trim().min(1), clientId: uuid, titleM2: num.positive(),
});
const exSchema = z.object({
  number: z.coerce.number().int().positive(), name: z.string().trim().min(1),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}/), periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  titleM2: num.positive(), contractorIds: z.array(uuid).min(1, 'назначьте подрядчика'), reason: z.string().default(''),
});

@Controller()
export class ApiController {
  constructor(
    private prisma: PrismaService, private state: StateService,
    private objects: ObjectsService, private forms: FormsService, private acts: ActsService,
  ) {}

  /** Все данные, видимые текущему пользователю (права применяются на сервере). */
  @Get('state')
  getState(@CurrentUser() u: AuthUser) { return this.state.snapshot(u); }

  // ---------- Объекты и выполнения (GC, CLIENT — свои) ----------
  @Roles('GC', 'CLIENT') @Post('objects')
  createObject(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.objects.saveObject(u, null, parse(objectSchema, b)); }

  @Roles('GC', 'CLIENT') @Put('objects/:id')
  updateObject(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) { return this.objects.saveObject(u, id, parse(objectSchema, b)); }

  @Roles('GC', 'CLIENT') @Delete('objects/:id')
  deleteObject(@CurrentUser() u: AuthUser, @Param('id', Id) id: string) { return this.objects.deleteObject(u, id); }

  @Roles('GC', 'CLIENT') @Post('objects/:id/executions')
  createExecution(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    const { reason, ...p } = parse(exSchema, b);
    return this.objects.saveExecution(u, id, null, p, reason);
  }

  @Roles('GC', 'CLIENT') @Put('executions/:id')
  async updateExecution(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    const { reason, ...p } = parse(exSchema, b);
    const ex = await this.prisma.execution.findUnique({ where: { id }, select: { objectId: true } });
    if (!ex) notFound('Выполнение не найдено');
    return this.objects.saveExecution(u, ex!.objectId, id, p, reason);
  }

  @Roles('GC', 'CLIENT') @Delete('executions/:id')
  deleteExecution(@CurrentUser() u: AuthUser, @Param('id', Id) id: string) { return this.objects.deleteExecution(u, id); }

  // ---------- Формы подрядчиков ----------
  @Roles('CONTRACTOR') @Post('executions/:id/form') @HttpCode(200)
  saveForm(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    const v = parse(z.object({
      lines: z.array(lineSchema).max(100), schemeFileId: uuid.nullable().optional(), photoFileId: uuid.nullable().optional(), submit: z.boolean().default(false),
    }), b);
    return this.forms.save(u, id, v, v.submit);
  }

  @Roles('CONTRACTOR') @Post('forms/:id/withdraw') @HttpCode(200)
  withdraw(@CurrentUser() u: AuthUser, @Param('id', Id) id: string) { return this.forms.withdraw(u, id); }

  @Roles('CLIENT') @Post('forms/:id/approve') @HttpCode(200)
  approveForm(@CurrentUser() u: AuthUser, @Param('id', Id) id: string) { return this.forms.clientApprove(u, id); }

  @Roles('CLIENT') @Post('forms/:id/reject') @HttpCode(200)
  rejectForm(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    return this.forms.clientReject(u, id, parse(z.object({ comment: z.string() }), b).comment);
  }

  // ---------- Акты ----------
  @Roles('GC', 'MANAGER') @Post('acts/:id/approve') @HttpCode(200)
  approveAct(@CurrentUser() u: AuthUser, @Param('id', Id) id: string) { return this.acts.gcApprove(u, id); }

  @Roles('GC', 'MANAGER') @Post('acts/:id/return') @HttpCode(200)
  returnAct(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    const v = parse(z.object({ contractorIds: z.array(uuid), comment: z.string() }), b);
    return this.acts.gcReturn(u, id, v.contractorIds, v.comment);
  }

  @Roles('GC', 'MANAGER') @Post('acts/archive') @HttpCode(200)
  archive(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.acts.archive(u, parse(z.object({ actIds: z.array(uuid).min(1) }), b).actIds); }

  @Roles('GC') @Post('acts/:id/correct') @HttpCode(200)
  correct(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    const v = parse(z.object({ rows: z.array(z.object({ contractorId: uuid, lines: z.array(lineSchema) })), reason: z.string() }), b);
    return this.acts.correct(u, id, v.rows, v.reason);
  }

  @Roles('GC', 'MANAGER', 'CLIENT') @Post('acts/:id/word') @HttpCode(200)
  async word(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Res() res: Response) {
    const { name, body } = await this.acts.word(u, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.end(body);
  }

  // ---------- Чат и уведомления ----------
  @Post('objects/:id/chat') @HttpCode(200)
  chat(@CurrentUser() u: AuthUser, @Param('id', Id) id: string, @Body() b: unknown) {
    return this.objects.sendChat(u, id, parse(z.object({ text: z.string().max(4000) }), b).text);
  }

  @Post('notifications/read') @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    const v = parse(z.object({ ids: z.union([z.array(uuid), z.literal('all')]) }), b);
    return this.objects.markRead(u, v.ids);
  }
}
