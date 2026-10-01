import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Хранилище файлов. STORAGE=s3 — MinIO (dev) / Yandex Object Storage (prod): меняется только S3_ENDPOINT.
 * STORAGE=local — папка на диске (для запуска без MinIO).
 * Файлы отдаются через API после проверки прав (FilesController). На этапе 3 можно перейти
 * на signed URLs (1 час) — ключи и бакет уже хранятся в StoredFile.
 */
@Injectable()
export class StorageService {
  private log = new Logger('Storage');
  readonly driver = (process.env.STORAGE || 'local') as 'local' | 's3';
  readonly bucket = process.env.S3_BUCKET || 'akty-dev';
  private dir = resolve(process.env.STORAGE_DIR || './storage');
  private s3 = this.driver === 's3'
    ? new S3Client({
        endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'ru-central1', forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' },
      })
    : null;

  constructor() { this.log.log(`driver=${this.driver} bucket=${this.bucket}`); }

  private localPath(key: string) {
    const p = resolve(join(this.dir, this.bucket, key));
    if (!p.startsWith(this.dir)) throw new Error('bad key');
    return p;
  }

  async put(key: string, body: Buffer, contentType: string) {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
      return;
    }
    const p = this.localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string, bucket = this.bucket): Promise<Buffer | null> {
    try {
      if (this.s3) {
        const r = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Buffer.from(await r.Body!.transformToByteArray());
      }
      return await readFile(resolve(join(this.dir, bucket, key)));
    } catch {
      return null;
    }
  }

  async remove(key: string, bucket = this.bucket) {
    try {
      if (this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      else await rm(resolve(join(this.dir, bucket, key)), { force: true });
    } catch (e: any) {
      this.log.warn(`remove ${key}: ${e.message}`);
    }
  }
}
