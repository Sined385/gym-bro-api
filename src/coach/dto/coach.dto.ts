import { IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  conversation_id?: string;

  // Optional regenerate flow. When action === 'regenerate' and
  // regenerate_from_message_id points at a prior assistant message
  // whose session exists, the backend appends a "skip these exercises"
  // directive to the OpenAI prompt for this turn only — the stored
  // user content stays clean ("Regenerate"), so the chat bubble reads
  // naturally instead of dumping the exclusion list to the user.
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  regenerate_from_message_id?: string;
}

export class MessageActionDto {
  @IsString()
  action!: string; // "start_workout" | "regenerate"
}
