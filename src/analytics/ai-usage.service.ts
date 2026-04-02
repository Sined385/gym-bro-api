import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async trackUsage(params: {
    userId: string;
    feature: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }): Promise<void> {
    const totalTokens = params.promptTokens + params.completionTokens;
    const estimatedCost = this.estimateCost(
      params.model,
      params.promptTokens,
      params.completionTokens,
    );

    await this.prisma.aiUsage.create({
      data: {
        user_id: params.userId,
        feature: params.feature,
        model: params.model,
        prompt_tokens: params.promptTokens,
        completion_tokens: params.completionTokens,
        total_tokens: totalTokens,
        estimated_cost: estimatedCost,
      },
    });
  }

  private estimateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    // Pricing per 1M tokens
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
    };
    const rates = pricing[model] ?? pricing['gpt-4o'];
    return (
      (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000
    );
  }
}
