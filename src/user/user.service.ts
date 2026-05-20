import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AppException } from '../common/exceptions/app.exception';
import { UpdateProfileDto } from './dto/user.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        username: true,
        avatar_url: true,
      },
    });

    if (!user) {
      throw new AppException(
        'USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
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
      select: {
        id: true,
        email: true,
        full_name: true,
        username: true,
        avatar_url: true,
      },
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
      console.error('Avatar upload error:', JSON.stringify(error));
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

  // Cascading hard-delete. Mirrors the manual SQL ordering we validated against
  // the live schema: child relations first, then User, then the Supabase auth
  // row via the admin client. There are no FKs to auth.users in our schema, so
  // ordering only matters for the post → workout_session SET NULL cascade and
  // for plan_days → workout_sessions (handled by deleting training_plans first).
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.postLike.deleteMany({ where: { user_id: userId } });
      await tx.postComment.deleteMany({ where: { user_id: userId } });
      await tx.follow.deleteMany({
        where: { OR: [{ follower_id: userId }, { following_id: userId }] },
      });
      await tx.friendship.deleteMany({
        where: { OR: [{ requester_id: userId }, { addressee_id: userId }] },
      });
      await tx.userBlock.deleteMany({
        where: { OR: [{ blocker_id: userId }, { blocked_id: userId }] },
      });
      await tx.contentReport.deleteMany({ where: { reporter_id: userId } });
      await tx.deviceToken.deleteMany({ where: { user_id: userId } });
      await tx.notification.deleteMany({ where: { user_id: userId } });
      await tx.analyticsEvent.deleteMany({ where: { user_id: userId } });
      await tx.aiUsage.deleteMany({ where: { user_id: userId } });
      await tx.weeklyOverview.deleteMany({ where: { user_id: userId } });
      await tx.workoutTemplate.deleteMany({ where: { user_id: userId } });
      await tx.motivationInsight.deleteMany({ where: { user_id: userId } });
      await tx.onboardingData.deleteMany({ where: { user_id: userId } });
      await tx.coachConversation.deleteMany({ where: { user_id: userId } });
      await tx.post.deleteMany({ where: { user_id: userId } });
      await tx.trainingPlan.deleteMany({ where: { user_id: userId } });
      await tx.workoutSession.deleteMany({ where: { user_id: userId } });
      await tx.exerciseFavorite.deleteMany({ where: { user_id: userId } });
      await tx.exerciseLibrary.deleteMany({ where: { user_id: userId } });
      await tx.sharedCard.deleteMany({ where: { user_id: userId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });

    // Best-effort avatar cleanup — failure here shouldn't roll back the deletion.
    try {
      await this.supabase
        .getClient()
        .storage.from('avatars')
        .remove([`avatars/${userId}.jpg`]);
    } catch (err) {
      this.logger.warn(`Avatar cleanup failed for ${userId}: ${String(err)}`);
    }

    // Best-effort post-cards cleanup. Listing first because remove() takes
    // exact paths; bucket is empty for most users so this is cheap.
    try {
      const { data: files } = await this.supabase
        .getClient()
        .storage.from('post-cards')
        .list(userId);
      if (files && files.length > 0) {
        await this.supabase
          .getClient()
          .storage.from('post-cards')
          .remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch (err) {
      this.logger.warn(
        `Post-cards cleanup failed for ${userId}: ${String(err)}`,
      );
    }

    // Drop the Supabase auth user. This invalidates refresh tokens; the current
    // access token still works until expiry, but every subsequent AuthGuard call
    // will 401 because supabase.auth.getUser() rejects deleted users.
    const { error } = await this.supabase
      .getClient()
      .auth.admin.deleteUser(userId);
    if (error) {
      this.logger.error(
        `Supabase auth delete failed for ${userId}: ${error.message}`,
      );
      throw new AppException(
        'AUTH_DELETE_FAILED',
        'User data deleted but auth record could not be removed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
