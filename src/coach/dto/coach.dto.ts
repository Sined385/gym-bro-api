import { IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  conversation_id?: string;
}

export class MessageActionDto {
  @IsString()
  action!: string; // "start_workout" | "regenerate"
}
