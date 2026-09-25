import { Module } from '@nestjs/common';
import { PiiAnnotationsService } from './pii-annotations.service.ts';
import { PiiLexiconService } from './pii-lexicon.service.ts';
import { PiiResultFilterService } from './pii-result-filter.service.ts';

@Module({
  providers: [PiiAnnotationsService, PiiLexiconService, PiiResultFilterService],
  exports: [PiiAnnotationsService, PiiLexiconService, PiiResultFilterService],
})
export class PiiDataModule {}
