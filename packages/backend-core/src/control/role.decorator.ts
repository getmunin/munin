import { SetMetadata } from '@nestjs/common';
import type { ActorType } from '@getmunin/core';
import type { OrgRole } from './role-guard.ts';

export const REQUIRE_ROLE_KEY = 'munin:require-role';
export const REQUIRE_ACTOR_TYPE_KEY = 'munin:require-actor-type';

/**
 * Require the calling user to hold one of the listed org roles. Admin API
 * keys with unrestricted scope (`*`) and system actors pass automatically —
 * matching `assertOwnerOrAdmin` semantics. To also block API keys, stack with
 * `@RequireActorType('user')`.
 */
export const RequireRole = (...roles: OrgRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ROLE_KEY, roles);

/**
 * Restrict the route to specific actor types (e.g. `'user'` for signed-in
 * dashboard sessions only, `'end_user_agent'` for delegated end-user agents).
 */
export const RequireActorType = (...types: ActorType[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ACTOR_TYPE_KEY, types);
