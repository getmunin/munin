import { BadRequestException } from '@nestjs/common';

function requireAllowlistFlag(envVar: string, defaultRequire: boolean): boolean {
  const raw = process.env[envVar]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return defaultRequire;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return defaultRequire;
}

export function assertOriginAllowlistPopulated(input: {
  origins: readonly string[];
  envVar: string;
  errorCode: string;
  field: string;
  defaultRequire?: boolean;
}): void {
  if (
    input.origins.length === 0 &&
    requireAllowlistFlag(input.envVar, input.defaultRequire ?? false)
  ) {
    throw new BadRequestException(
      `${input.errorCode}: this deployment requires at least one entry in \`${input.field}\` (full origin like \`https://app.example.com\`). Add the production and any preview origins before saving.`,
    );
  }
}
