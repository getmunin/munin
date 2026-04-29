import { Module } from '@nestjs/common';
import { ConvService } from './conv.service.js';
import { ConvAdminTools } from './conv.tools.js';
import { ConvSelfServiceTools } from './conv.self-service.tools.js';

@Module({
  providers: [ConvService, ConvAdminTools, ConvSelfServiceTools],
  exports: [ConvService],
})
export class ConvModule {}
