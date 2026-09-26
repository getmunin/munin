import { Module } from '@nestjs/common';
import { PiiAnnotationsService } from './pii-annotations.service.ts';
import { PiiLexiconService } from './pii-lexicon.service.ts';
import { PiiResultFilterService } from './pii-result-filter.service.ts';
import { PiiStatusService } from './pii-status.service.ts';

@Module({
  providers: [PiiAnnotationsService, PiiLexiconService, PiiResultFilterService, PiiStatusService],
  exports: [PiiAnnotationsService, PiiLexiconService, PiiResultFilterService, PiiStatusService],
})
export class PiiDataModule {}
