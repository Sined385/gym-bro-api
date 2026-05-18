import {
  Controller,
  Delete,
  Get,
  Put,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/user.dto';

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/heic']);

@Controller('api/v1/user')
@UseGuards(AuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  async getProfile(@Req() req: Request) {
    return this.userService.getProfile(req.user!.id);
  }

  @Put('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Body() dto: UpdateProfileDto, @Req() req: Request) {
    return this.userService.updateProfile(req.user!.id, dto);
  }

  @Get('check-username/:username')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  async checkUsername(@Param('username') username: string) {
    return this.userService.checkUsername(username);
  }

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_AVATAR_MIME.has(file.mimetype)) cb(null, true);
        else
          cb(
            new BadRequestException(
              'Only JPEG, PNG, or HEIC images are allowed',
            ),
            false,
          );
      },
    }),
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file');
    }
    return this.userService.uploadAvatar(req.user!.id, file);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(@Req() req: Request) {
    await this.userService.deleteAccount(req.user!.id);
  }
}
