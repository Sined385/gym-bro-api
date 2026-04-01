import { IsString, IsOptional, IsObject } from 'class-validator';

export class TrackEventDto {
  @IsString()
  event_name: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, any>;
}
