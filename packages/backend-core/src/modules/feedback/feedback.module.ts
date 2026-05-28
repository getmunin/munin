import { Global, Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service.ts';
import { FeedbackController } from './feedback.controller.ts';
import { FeedbackTools } from './feedback.tools.ts';
import { FeedbackForwarder } from './feedback.forwarder.ts';
import { InstanceIdService } from './instance-id.service.ts';

@Global()
@Module({
  controllers: [FeedbackController],
  providers: [InstanceIdService, FeedbackForwarder, FeedbackService, FeedbackTools],
  exports: [FeedbackService, InstanceIdService],
})
export class FeedbackModule {}

export function isFeedbackEnabled(): boolean {
  const raw = process.env.MUNIN_FEEDBACK_ENABLED;
  if (raw === undefined) return false;
  return raw.toLowerCase() === 'true' || raw === '1';
}
