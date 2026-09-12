import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/tenant/tenant-context.middleware';
import { StorageService } from './storage.service';

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Usado pelo app mobile para enviar a foto opcional da perda (funcionalidade 1
// do documento) ANTES de enviar o registro em si: o app sobe a imagem aqui,
// recebe a URL pública, e inclui essa URL no POST /losses.
@Controller('uploads')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Post('loss-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  async uploadLossImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "file").');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
    }
    if (!user.companyId) {
      throw new BadRequestException('Usuário sem empresa associada não pode enviar imagens.');
    }

    const { url } = await this.storageService.uploadBuffer({
      companyId: user.companyId,
      folder: 'losses',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });

    return { url };
  }
}
