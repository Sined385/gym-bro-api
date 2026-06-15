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

  // iOS-side timing fix: the Regenerate button enables as soon as the
  // workout card renders (session_created SSE), but the assistant
  // message's real id isn't bound until the `done` event. A fast tap
  // sends the optimistic UUID as `regenerate_from_message_id`, the
  // server can't find that message, the skip list is empty, and the
  // AI proposes the same workout. session.id is set at session_created
  // time and is always real, so newer clients pass it here and the
  // server prefers it over the message-id lookup.
  @IsOptional()
  @IsString()
  regenerate_from_session_id?: string;
}

export class MessageActionDto {
  @IsString()
  action!: string; // "start_workout" | "regenerate"
}
