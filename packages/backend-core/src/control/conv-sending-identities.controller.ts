import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  SendingIdentityService,
  type SendingIdentityDto,
} from '../modules/conv/sending-identities/sending-identity.service.ts';

const CreateSendingIdentitySchema = z.object({
  domain: z.string().min(1).max(253),
});

class CreateSendingIdentityBody extends createZodDto(CreateSendingIdentitySchema) {}

interface SendingIdentityListResponse {
  items: SendingIdentityDto[];
}

@Controller('v1/conversations/sending-identities')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class ConvSendingIdentitiesController {
  constructor(private readonly identities: SendingIdentityService) {}

  @Get()
  async list(): Promise<SendingIdentityListResponse> {
    return { items: await this.identities.list() };
  }

  @Post()
  @HttpCode(200)
  create(@Body() input: CreateSendingIdentityBody): Promise<SendingIdentityDto> {
    return this.identities.create({ domain: input.domain });
  }

  @Post(':id/refresh')
  @HttpCode(200)
  refresh(@Param('id') id: string): Promise<SendingIdentityDto> {
    return this.identities.refresh(id);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string): Promise<{ deleted: true }> {
    return this.identities.remove(id);
  }
}
