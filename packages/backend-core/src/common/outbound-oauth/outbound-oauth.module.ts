import { Module } from '@nestjs/common';
import { OutboundOAuthStore } from './grant-store.ts';

@Module({
  providers: [OutboundOAuthStore],
  exports: [OutboundOAuthStore],
})
export class OutboundOAuthModule {}
