import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthUser, CurrentUser, Roles, isStaff } from '../common/auth';
import { biz, forbid, notFound } from '../common/errors';
import { parse, z } from '../common/zod';
import { PrismaService } from '../prisma.service';
import { makeDemoPdf } from './demo-files';
import { StorageService } from './storage.service';

const MAX = 50 * 1024 * 1024;

@Controller('files')
export class FilesController {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  /** Загрузка PDF-схемы / PDF-фото подрядчиком. Привязка к форме — при сохранении формы. */
  @Roles('CONTRACTOR')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() b: unknown) {
    const { kind } = parse(z.object({ kind: z.enum(['SCHEME', 'PHOTO']) }), b);
    if (!file) biz('Файл не передан');
    const name = Buffer.from(file!.originalname, 'latin1').toString('utf8'); // multer отдаёт имя в latin1
    const isPdf = file!.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf) biz('Допускаются только PDF-файлы');
    const key = `forms/${u.contractorId}/${randomUUID()}.pdf`;
    await this.storage.put(key, file!.buffer, 'application/pdf');
    const f = await this.prisma.storedFile.create({
      data: { kind, bucket: this.storage.bucket, key, originalName: name, mimeType: 'application/pdf', size: BigInt(file!.size), uploadedById: u.id },
    });
    return { id: f.id, name, size: file!.size, uploadedAt: f.createdAt.toISOString(), uploadedBy: u.id };
  }

  /**
   * Скачивание с проверкой прав (п. 2 и 5 ТЗ):
   * GC/MANAGER — все файлы; подрядчик — свои (формы и строки актов своей организации);
   * заказчик — файлы актов и Word по объектам своей организации.
   */
  @Get(':id')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.prisma.storedFile.findUnique({
      where: { id },
      include: {
        formSchemes: { select: { contractorId: true } }, formPhotos: { select: { contractorId: true } },
        actRowSchemes: { select: { contractorId: true, act: { select: { object: { select: { clientId: true } } } } } },
        actRowPhotos: { select: { contractorId: true, act: { select: { object: { select: { clientId: true } } } } } },
        actWord: { select: { object: { select: { clientId: true } } } },
      },
    });
    if (!f) notFound('Файл не найден');
    const rows = [...f!.actRowSchemes, ...f!.actRowPhotos];
    let ok = isStaff(u.role);
    if (u.role === 'CONTRACTOR') {
      ok = f!.uploadedById === u.id
        || [...f!.formSchemes, ...f!.formPhotos, ...rows].some((x) => x.contractorId === u.contractorId);
    }
    if (u.role === 'CLIENT') {
      ok = rows.some((r) => r.act.object.clientId === u.clientId) || f!.actWord?.object.clientId === u.clientId;
    }
    if (!ok) forbid('Нет доступа к файлу');
    // Демо-файлы из seed физически не загружены — отдаём сгенерированный PDF
    const body = (await this.storage.get(f!.key, f!.bucket)) ?? (f!.mimeType === 'application/pdf' ? makeDemoPdf(f!.originalName) : null);
    if (!body) notFound('Файл отсутствует в хранилище');
    res.setHeader('Content-Type', f!.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f!.originalName)}`);
    res.end(body);
  }
}
