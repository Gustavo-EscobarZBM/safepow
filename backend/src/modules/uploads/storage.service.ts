import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * Cliente de object storage compatível com S3 (Seção 2.3 do documento):
 * funciona com AWS S3, DigitalOcean Spaces, Cloudflare R2 ou MinIO (dev
 * local) apenas trocando as variáveis de ambiente — nenhuma delas é
 * exclusiva de um provedor.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('STORAGE_BUCKET', 'inventory-saas-uploads');
    this.publicBaseUrl = this.config.get<string>(
      'STORAGE_PUBLIC_BASE_URL',
      `http://localhost:9000/${this.bucket}`,
    );

    this.client = new S3Client({
      endpoint: this.config.get<string>('STORAGE_ENDPOINT'),
      region: this.config.get<string>('STORAGE_REGION', 'us-east-1'),
      forcePathStyle: this.config.get<string>('STORAGE_FORCE_PATH_STYLE') === 'true',
      credentials: {
        accessKeyId: this.config.get<string>('STORAGE_ACCESS_KEY', ''),
        secretAccessKey: this.config.get<string>('STORAGE_SECRET_KEY', ''),
      },
    });
  }

  /**
   * Faz upload de um arquivo (buffer em memória, vindo do multer) e devolve
   * a URL pública. O nome do objeto é prefixado por companyId para manter os
   * arquivos de cada tenant organizados no bucket (isolamento lógico, ainda
   * que o bucket seja compartilhado — Seção 1.2 do documento).
   */
  async uploadBuffer(params: {
    companyId: string;
    folder: 'losses' | 'imports';
    buffer: Buffer;
    contentType: string;
    originalName: string;
  }): Promise<{ key: string; url: string }> {
    const extension = params.originalName.includes('.')
      ? params.originalName.split('.').pop()
      : 'bin';
    const key = `${params.companyId}/${params.folder}/${randomUUID()}.${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.contentType,
      }),
    );

    return { key, url: `${this.publicBaseUrl}/${key}` };
  }

  /** Usado pelo worker de importação de planilhas para reler o arquivo (Seção 5.2). */
  async downloadBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = response.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
