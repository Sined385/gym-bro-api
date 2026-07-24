import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveLang } from '../common/i18n';

// Last language persisted per user (module-level so it survives guard
// instances). Lets us skip the User.language write on every request —
// we only touch the DB when the device's language actually changes.
const knownLanguages = new Map<string, string>();

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

    // iOS sends X-App-Language; Accept-Language covers other clients.
    const language = resolveLang(
      request.headers['x-app-language'] ?? request.headers['accept-language'],
    );
    request.user = { id: data.user.id, email: data.user.email ?? '', language };

    // Persist the language so crons / background jobs can localize
    // without a request context. Fire-and-forget — never blocks auth.
    if (knownLanguages.get(data.user.id) !== language) {
      knownLanguages.set(data.user.id, language);
      this.prisma.user
        .update({ where: { id: data.user.id }, data: { language } })
        .catch(() => {});
    }

    // Ensure User row exists (non-blocking, never fails auth)
    const user = data.user;
    if (!this.syncedUsers.has(user.id)) {
      this.syncedUsers.add(user.id); // Mark immediately to avoid retry spam
      try {
        const meta = user.user_metadata ?? {};
        const fullName =
          (meta.full_name as string) ?? (meta.name as string) ?? null;
        const avatarUrl =
          (meta.avatar_url as string) ?? (meta.picture as string) ?? null;
        // First delete any stale seed row with the same email but different id
        await this.prisma.user.deleteMany({
          where: { email: user.email ?? '', id: { not: user.id } },
        });
        await this.prisma.user.upsert({
          where: { id: user.id },
          update: { email: user.email ?? '' },
          create: {
            id: user.id,
            email: user.email ?? '',
            full_name: fullName,
            avatar_url: avatarUrl,
          },
        });
      } catch {
        // Non-critical — profile page will just show defaults
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
