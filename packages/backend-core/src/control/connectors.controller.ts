import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import { ConnectorsService } from '../modules/connectors/connectors.service.ts';

const CreateBody = z.object({
  vendor: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).optional(),
});

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

const CredentialsBody = z.object({
  secrets: z.record(z.string(), z.string().min(1)),
});

@Controller('v1/connectors')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get('vendors')
  listVendors() {
    return { vendors: this.connectors.listVendors() };
  }

  @Get()
  async list() {
    return { connections: await this.connectors.listConnections() };
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.connectors.createConnection(parsed.data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.connectors.updateConnection({ connectionId: id, ...parsed.data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.connectors.deleteConnection({ connectionId: id });
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.connectors.testConnection({ connectionId: id });
  }

  @Post(':id/credentials')
  applyCredentials(@Param('id') id: string, @Body() body: unknown) {
    const parsed = CredentialsBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.connectors.applyCredentials(id, parsed.data.secrets);
  }

  @Post(':id/credential-link')
  requestCredentials(@Param('id') id: string) {
    return this.connectors.requestCredentials({ connectionId: id });
  }
}
