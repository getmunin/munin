import { SetMetadata } from '@nestjs/common';
import type { ActorType } from '@getmunin/core';
import type { OrgRole } from './role-guard.ts';

export const REQUIRE_ROLE_KEY = 'munin:require-role';
export const REQUIRE_ACTOR_TYPE_KEY = 'munin:require-actor-type';

export const RequireRole = (...roles: OrgRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ROLE_KEY, roles);

export const RequireActorType = (...types: ActorType[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ACTOR_TYPE_KEY, types);
