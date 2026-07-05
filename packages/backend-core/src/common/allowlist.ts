import { BadRequestException } from '@nestjs/common';
import { parseEnvBool } from '@getmunin/core';

export function assertOriginAllowlistPopulated(input: {
  origins: readonly string[];
  envVar: string;
  errorCode: string;
  field: string;
  defaultRequire?: boolean;
}): void {
  if (
    input.origins.length === 0 &&
    parseEnvBool({ name: input.envVar, default: input.defaultRequire ?? false })
  ) {
    throw new BadRequestException(
      `${input.errorCode}: this deployment requires at least one entry in \`${input.field}\` (full origin like \`https://app.example.com\`). Add the production and any preview origins before saving.`,
    );
  }
}
