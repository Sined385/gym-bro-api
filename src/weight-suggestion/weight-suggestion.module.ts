import { Module } from '@nestjs/common';
import { WeightSuggestionService } from './weight-suggestion.service';

// Standalone module so both HomeModule and PlansModule can consume the
// weight-suggestion utility without forcing a cycle. (HomeModule used to
// own this provider, which is why importing HomeModule from PlansModule
// was the only path — and that blocked HomeService from depending on
// PlansService for plan adaptation.)
@Module({
  providers: [WeightSuggestionService],
  exports: [WeightSuggestionService],
})
export class WeightSuggestionModule {}
