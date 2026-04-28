import { Module } from '@nestjs/common';
import { DeskService } from './desk.service.js';
import { DeskAdminTools } from './desk.tools.js';
import { DeskSelfServiceTools } from './desk.self-service.tools.js';

@Module({
  providers: [DeskService, DeskAdminTools, DeskSelfServiceTools],
  exports: [DeskService],
})
export class DeskModule {}
