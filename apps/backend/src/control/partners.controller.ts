import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { PartnerGuard } from '../common/auth/partner.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { PartnersService } from './partners.service.js';

const ProvisionDto = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  ownerEmail: z.string().email(),
  ownerName: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PatchOrgDto = z.object({
  name: z.string().min(1).max(120).optional(),
});

const OwnerInviteDto = z.object({
  email: z.string().email(),
});

@Controller('api/partner/orgs')
@UseGuards(AuthGuard, PartnerGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class PartnerOrgsController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

  @Post()
  @HttpCode(201)
  async provision(@Body() body: unknown) {
    const parsed = ProvisionDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.partners.provisionOrg(parsed.data);
  }

  @Get()
  list() {
    return this.partners.listOrgs();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.partners.getOrg(id);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown) {
    const parsed = PatchOrgDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.partners.patchOrg(id, parsed.data);
  }

  @Post(':id/owner-invite')
  @HttpCode(200)
  async ownerInvite(@Param('id') id: string, @Body() body: unknown) {
    const parsed = OwnerInviteDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.partners.resendOwnerInvite(id, parsed.data.email);
  }
}
