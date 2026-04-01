import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AppException } from '../common/exceptions/app.exception';
import { UpdateProfileDto } from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, full_name: true, username: true, avatar_url: true },
    });

    if (!user) {
      throw new AppException('USER_NOT_FOUND', 'User not found', HttpStatus.NOT_FOUND);
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      const usernameRegex = /^[a-zA-Z0-9_]+$/;
      if (!usernameRegex.test(dto.username)) {
        throw new AppException(
          'INVALID_USERNAME',
          'Username can only contain letters, numbers, and underscores',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.username.length < 3 || dto.username.length > 30) {
        throw new AppException(
          'INVALID_USERNAME',
          'Username must be between 3 and 30 characters',
          HttpStatus.BAD_REQUEST,
        );
      }

      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (existing && existing.id !== userId) {
        throw new AppException(
          'USERNAME_TAKEN',
          'This username is already taken',
          HttpStatus.CONFLICT,
        );
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.username !== undefined && { username: dto.username }),
        ...(dto.avatar_url !== undefined && { avatar_url: dto.avatar_url }),
      },
      select: { id: true, email: true, full_name: true, username: true, avatar_url: true },
    });

    return user;
  }

  async checkUsername(username: string) {
    const existing = await this.prisma.user.findUnique({
      where: { username },
    });
    return { available: !existing };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const filePath = `avatars/${userId}.jpg`;
    const bucket = this.supabase.getClient().storage.from('avatars');

    // Upload (upsert) the file
    const { error } = await bucket.upload(filePath, file.buffer, {
      contentType: file.mimetype || 'image/jpeg',
      upsert: true,
    });

    if (error) {
      throw new AppException(
        'AVATAR_UPLOAD_FAILED',
        `Failed to upload avatar: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Get public URL
    const { data: urlData } = bucket.getPublicUrl(filePath);
    const avatarUrl = urlData.publicUrl;

    // Update user record
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar_url: avatarUrl },
    });

    return { avatar_url: avatarUrl };
  }

  generateUsername(fullName: string): string {
    return fullName
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 26);
  }
}
