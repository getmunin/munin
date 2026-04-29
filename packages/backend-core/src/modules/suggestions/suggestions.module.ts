import { Module } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service.js';
import { SuggestionsTools } from './suggestions.tools.js';

@Module({
  providers: [SuggestionsService, SuggestionsTools],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
