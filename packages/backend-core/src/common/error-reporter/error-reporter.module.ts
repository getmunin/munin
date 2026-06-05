import { Global, Module } from '@nestjs/common';
import { ERROR_REPORTER, NoopErrorReporter } from './error-reporter.ts';

@Global()
@Module({
  providers: [{ provide: ERROR_REPORTER, useClass: NoopErrorReporter }],
  exports: [ERROR_REPORTER],
})
export class ErrorReporterModule {}
