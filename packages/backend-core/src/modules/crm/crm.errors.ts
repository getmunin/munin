export class CrmInvalidError extends Error {
  readonly code = 'crm_invalid';
  constructor(message: string) {
    super(`crm_invalid: ${message}`);
  }
}
