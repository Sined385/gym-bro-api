import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Keys per authenticated user when present; falls back to client IP for public
// routes so shared NAT users on authenticated endpoints aren't punished by a
// single noisy neighbor.
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ?? req.ip;
  }
}
