export class OutreachInvalidError extends Error {
  readonly code: string;
  constructor(message: string, code = 'outreach_invalid') {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export class OutreachUndeliverableError extends OutreachInvalidError {
  constructor(message: string) {
    super(message, 'outreach_undeliverable');
  }
}
