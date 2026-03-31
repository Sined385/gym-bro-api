import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private jwks: JwksClient;
  private syncedUsers = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.jwks = new JwksClient({
      jwksUri: `${this.config.getOrThrow('SUPABASE_URL')}/auth/v1/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600_000, // 10 min
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded) {
        throw new Error('Malformed token');
      }

      const kid = decoded.header.kid;
      const key = await this.jwks.getSigningKey(kid);
      const publicKey = key.getPublicKey();

      const payload = jwt.verify(token, publicKey) as jwt.JwtPayload;
      const userId = payload.sub!;
      const email = payload.email;
      const meta = payload.user_metadata ?? {};
      request.user = { id: userId, email };

      // Ensure User row exists (cached per process lifetime to avoid repeated DB calls)
      if (!this.syncedUsers.has(userId)) {
        await this.prisma.user.upsert({
          where: { id: userId },
          create: {
            id: userId,
            email: email ?? '',
            full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
            avatar_url: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
          },
          update: {},
        });
        this.syncedUsers.add(userId);
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
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
