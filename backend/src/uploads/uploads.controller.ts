import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

interface UploadedFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/uploads')
export class UploadsController {
  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const ok =
          ALLOWED_EXT.has(ext) && /^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype);
        if (!ok) {
          return cb(new BadRequestException('only image files are allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: MAX_FILE_BYTES, files: 10 },
    }),
  )
  upload(@UploadedFiles() files: UploadedFile[] | undefined) {
    if (!files || files.length === 0) {
      throw new BadRequestException('no files provided');
    }
    return {
      uploaded: files.map((f) => ({
        url: `/uploads/${f.filename}`,
        filename: f.filename,
        size: f.size,
      })),
    };
  }
}
