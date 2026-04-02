import {
  Controller,
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/user.dto';

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
  async checkUsername(@Param('username') username: string) {
    return this.userService.checkUsername(username);
  }

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.userService.uploadAvatar(req.user!.id, file);
  }
}
