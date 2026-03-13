import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type Client = ReturnType<typeof createClient>;

@Injectable()
export class SupabaseService {
  private readonly client: Client;

  constructor(private readonly config: ConfigService) {
    const url = this.config.getOrThrow<string>('SUPABASE_URL');
    const key = this.config.getOrThrow<string>('SUPABASE_KEY');
    this.client = createClient(url, key);
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
