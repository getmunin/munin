import { ConsoleLogger } from '@nestjs/common';
import { redactLogValue } from '@getmunin/core';

export class RedactingConsoleLogger extends ConsoleLogger {
  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(redactLogValue(message), ...optionalParams.map(redactLogValue));
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(redactLogValue(message), ...optionalParams.map(redactLogValue));
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(redactLogValue(message), ...optionalParams.map(redactLogValue));
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(redactLogValue(message), ...optionalParams.map(redactLogValue));
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(redactLogValue(message), ...optionalParams.map(redactLogValue));
  }

  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(redactLogValue(message), ...optionalParams.map(redactLogValue));
  }
}
