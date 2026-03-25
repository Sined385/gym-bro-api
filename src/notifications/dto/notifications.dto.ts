import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  platform?: string;
}

export class RemoveTokenDto {
  @IsString()
  token!: string;
}

export class MarkReadDto {
  // No body needed — notificationId comes from route param
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
