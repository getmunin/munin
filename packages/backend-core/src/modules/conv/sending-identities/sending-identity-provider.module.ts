import { Global, Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { DnsProbeSendingIdentityProvider } from './dns-probe.provider.ts';
import { SENDING_IDENTITY_PROVIDER, type SendingIdentityProvider } from './provider.ts';

export interface SendingIdentityProviderModuleOptions {
  provider?: Type<SendingIdentityProvider>;
  imports?: DynamicModule['imports'];
  extraProviders?: Provider[];
}

@Global()
@Module({})
export class SendingIdentityProviderModule {
  static forRoot(options: SendingIdentityProviderModuleOptions = {}): DynamicModule {
    const implementation = options.provider ?? DnsProbeSendingIdentityProvider;
    return {
      module: SendingIdentityProviderModule,
      imports: options.imports ?? [],
      providers: [
        ...(options.extraProviders ?? []),
        implementation,
        { provide: SENDING_IDENTITY_PROVIDER, useExisting: implementation },
      ],
      exports: [SENDING_IDENTITY_PROVIDER, implementation],
    };
  }
}
