import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.ts';

@Module({
  controllers: [AuthController],
})
export class AuthModule {}
