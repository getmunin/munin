import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Db, Tx } from '@getmunin/db';

export const MEMBERSHIP_HOOKS = Symbol('membershipHooks');

export interface MembershipHookUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export interface MembershipHooks {
  afterLastMembershipRemoved?: (db: Db | Tx, user: MembershipHookUser) => Promise<void>;
}

@Global()
@Module({})
export class MembershipHooksModule {
  static forRoot(hooks: MembershipHooks): DynamicModule {
    return {
      module: MembershipHooksModule,
      providers: [{ provide: MEMBERSHIP_HOOKS, useValue: hooks }],
      exports: [MEMBERSHIP_HOOKS],
    };
  }
}
