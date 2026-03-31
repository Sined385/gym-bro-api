import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private syncedUsers = new Set<string>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const { data, error } = await this.supabase.getClient().auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = { id: data.user.id, email: data.user.email ?? '' };

    // Ensure User row exists (non-blocking, never fails auth)
    const user = data.user;
    if (!this.syncedUsers.has(user.id)) {
      try {
        const meta = user.user_metadata ?? {};
        await this.prisma.user.upsert({
          where: { id: user.id },
          update: {
            email: user.email ?? '',
            full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
            avatar_url: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
          },
          create: {
            id: user.id,
            email: user.email ?? '',
            full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
            avatar_url: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
          },
        });
        this.syncedUsers.add(user.id);
      } catch (err) {
        console.warn('[AuthGuard] User sync failed:', (err as Error).message);
      }
    }

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.slice(7);
  }
}
