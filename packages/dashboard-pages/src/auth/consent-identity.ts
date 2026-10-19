export interface ConsentIdentityInput {
  clientId: string;
  clientName: string | null | undefined;
  impersonates: string | null | undefined;
  registeredRedirectHost: string | null | undefined;
  requestedRedirectUri: string | null | undefined;
}

export interface ConsentIdentity {
  displayName: string;
  redirectHost: string | null;
  showClientIcon: boolean;
  impersonates: string | null;
}

export function redirectHostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

export function resolveConsentIdentity(input: ConsentIdentityInput): ConsentIdentity {
  const redirectHost =
    redirectHostOf(input.requestedRedirectUri) ?? (input.registeredRedirectHost || null);
  const impersonates = input.impersonates?.trim() ? input.impersonates.trim() : null;
  if (impersonates) {
    return {
      displayName: redirectHost ?? input.clientId,
      redirectHost,
      showClientIcon: false,
      impersonates,
    };
  }
  return {
    displayName: input.clientName?.trim() ? input.clientName : input.clientId,
    redirectHost,
    showClientIcon: true,
    impersonates: null,
  };
}
