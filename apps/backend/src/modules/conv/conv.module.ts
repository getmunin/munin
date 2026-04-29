import { Module } from '@nestjs/common';
import { ConvService } from './conv.service.js';
import { ConvAdminTools } from './conv.tools.js';
import { ConvSelfServiceTools } from './conv.self-service.tools.js';
import { EmailService } from './email/email.service.js';
import { EmailAdminTools } from './email/email.tools.js';
import { EmailOutboundWorker } from './email/email-outbound.worker.js';
import { EmailInboundWorker } from './email/email-inbound.worker.js';

@Module({
  providers: [
    ConvService,
    ConvAdminTools,
    ConvSelfServiceTools,
    EmailService,
    EmailAdminTools,
    EmailOutboundWorker,
    EmailInboundWorker,
  ],
  exports: [ConvService, EmailService, EmailOutboundWorker, EmailInboundWorker],
})
export class ConvModule {}
