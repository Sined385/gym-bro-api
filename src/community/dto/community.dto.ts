import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  IsIn,
} from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString()
  @IsIn(['global', 'followers'])
  visibility?: string;

  @IsOptional()
  @IsString()
  workout_session_id?: string;

  @IsOptional()
  @IsString()
  photo_url?: string;

  // Loose-bag JSON: stored as-is, never interpreted server-side. iOS owns
  // the schema and evolves it independently. Future clients tolerantly decode.
  @IsOptional()
  @IsObject()
  share_config?: Record<string, any>;

  // Public URL of a pre-rasterized 1080×1920 PNG of the share card. Used as
  // og:image on the /p/:postId HTML preview so link unfurls show the real card.
  @IsOptional()
  @IsString()
  card_image_url?: string;
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content!: string;
}

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['global', 'following'])
  tab?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class FollowUserDto {
  @IsString()
  userId!: string;
}

export class CreateReportDto {
  @IsString()
  @IsIn(['post', 'comment', 'user'])
  contentType!: string;

  @IsString()
  contentId!: string;

  @IsString()
  @IsIn(['spam', 'harassment', 'inappropriate_content', 'other'])
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class BlockUserDto {
  @IsString()
  userId!: string;
}

export class ToggleReactionDto {
  @IsString()
  @IsIn(['fire', 'muscle', 'heart', 'clap', 'wow', 'trophy'])
  emoji!: string;
}
