import { Global, Module } from '@nestjs/common';
import { readMailerFromEnv, type Mailer } from '@munin/core';

export const MAILER = Symbol('Mailer');

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: (): Mailer => readMailerFromEnv(),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
