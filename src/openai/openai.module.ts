import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Global()
@Module({
  providers: [
    {
      provide: 'OPENAI_CLIENT',
      useFactory: (config: ConfigService) =>
        new OpenAI({ apiKey: config.get('OPENAI_API_KEY') }),
      inject: [ConfigService],
    },
  ],
  exports: ['OPENAI_CLIENT'],
})
export class OpenAIModule {}
