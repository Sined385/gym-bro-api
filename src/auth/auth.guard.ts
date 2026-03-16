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

    // Sync user to public.User table (upsert)
    const user = data.user;
    const meta = user.user_metadata ?? {};
    await this.prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email ?? '',
        full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
        avatar_url:
          (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
      },
      create: {
        id: user.id,
        email: user.email ?? '',
        full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
        avatar_url:
          (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
      },
    });

    // Attach the authenticated user to the request for downstream use
    request.user = data.user;

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
