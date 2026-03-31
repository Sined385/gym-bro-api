import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  async register(dto: RegisterDto) {
    const { data, error } = await this.supabase
      .getClient()
      .auth.signUp({ email: dto.email, password: dto.password });

    if (error) {
      throw new BadRequestException(error.message);
    }

    const supabaseUser = data.user!;

    // Sync the new user into our own DB
    const user = await this.prisma.user.upsert({
      where: { id: supabaseUser.id },
      create: {
        id: supabaseUser.id,
        email: supabaseUser.email!,
      },
      update: {},
    });

    this.analytics.track(user.id, 'user_registered', {
      email: user.email,
    });

    return {
      user,
      session: data.session,
    };
  }

  async login(dto: LoginDto) {
    const { data, error } = await this.supabase
      .getClient()
      .auth.signInWithPassword({ email: dto.email, password: dto.password });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    const supabaseUser = data.user;
    const meta = supabaseUser.user_metadata ?? {};

    // Ensure user exists in public.User table
    await this.prisma.user.upsert({
      where: { id: supabaseUser.id },
      create: {
        id: supabaseUser.id,
        email: supabaseUser.email ?? '',
        full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
        avatar_url: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
      },
      update: {
        email: supabaseUser.email ?? '',
        full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
        avatar_url: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
      },
    });

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      user: supabaseUser,
    };
  }
}
