import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSharedCardDto } from './dto/shared-card.dto';

@Injectable()
export class SharedCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /// Persists a standalone shareable card (decoupled from community posts).
  /// Returns the row id + the full public web URL used by the system share
  /// sheet on iOS.
  async createSharedCard(userId: string, dto: CreateSharedCardDto) {
    const row = await this.prisma.sharedCard.create({
      data: {
        user_id: userId,
        card_image_url: dto.card_image_url,
        share_config: dto.share_config ?? undefined,
        workout_session_id: dto.workout_session_id ?? null,
      },
    });

    const shareDomain =
      this.configService.get<string>('SHARE_DOMAIN') || 'https://gyymjaam.com';

    return {
      id: row.id,
      share_url: `${shareDomain}/c/${row.id}`,
    };
  }

  /// Public read for the unauthenticated /c/:id HTML route. No visibility
  /// filter — every shared_cards row is link-public by design (parallel to
  /// templates at /s/:code).
  async getSharedCardPublic(shareId: string) {
    const card = await this.prisma.sharedCard.findUnique({
      where: { id: shareId },
    });
    if (!card) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: card.user_id },
    });
    return { card, user };
  }
}
