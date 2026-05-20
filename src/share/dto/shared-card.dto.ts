import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSharedCardDto {
  // Public URL of the rasterized 1080×1920 card already uploaded to the
  // post-cards Storage bucket. We don't re-host or proxy — just point at it.
  @IsString()
  card_image_url!: string;

  // Loose-bag JSON: same forward-compat contract as posts.share_config.
  // Server stores as-is, never interprets.
  @IsOptional()
  @IsObject()
  share_config?: Record<string, any>;

  @IsOptional()
  @IsString()
  workout_session_id?: string;
}
