export interface CredentialFieldSpec {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface CredentialTargetDescription {
  label: string;
  vendor: string;
  fields: CredentialFieldSpec[];
}

export interface CredentialApplyResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

/**
 * A domain's plug into the credential-handoff flow. `describe` and `apply`
 * run inside a system-actor request context (org resolved from the link), so
 * implementations use the ambient `getCurrentContext()` db like any tool.
 */
export interface CredentialTargetHandler {
  readonly targetType: string;
  describe(targetId: string): Promise<CredentialTargetDescription | null>;
  apply(targetId: string, secrets: Record<string, string>): Promise<CredentialApplyResult>;
}

export class CredentialTargetRegistry {
  private readonly byType = new Map<string, CredentialTargetHandler>();

  register(handler: CredentialTargetHandler): void {
    if (this.byType.has(handler.targetType)) {
      throw new Error(`credential target already registered: ${handler.targetType}`);
    }
    this.byType.set(handler.targetType, handler);
  }

  get(targetType: string): CredentialTargetHandler | null {
    return this.byType.get(targetType) ?? null;
  }
}
