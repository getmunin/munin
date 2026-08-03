export class ChannelSendTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelSendTerminalError';
  }
}

export class ChannelSendDeferredError extends Error {
  readonly nextAttemptAt: Date;

  constructor(message: string, nextAttemptAt: Date) {
    super(message);
    this.name = 'ChannelSendDeferredError';
    this.nextAttemptAt = nextAttemptAt;
  }
}
