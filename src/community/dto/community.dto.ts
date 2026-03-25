import {
  IsInt,
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
