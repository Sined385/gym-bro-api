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

@Injectable()
export class AuthGuard implements CanActivate {
  private jwks: JwksClient;

  constructor(private readonly config: ConfigService) {
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
      request.user = { id: payload.sub!, email: payload.email };
    } catch {
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
