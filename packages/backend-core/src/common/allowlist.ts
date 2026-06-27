import { BadRequestException } from '@nestjs/common';

function requireAllowlistFlag(envVar: string): boolean {
  const raw = process.env[envVar]?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function assertOriginAllowlistPopulated(input: {
  origins: readonly string[];
  envVar: string;
  errorCode: string;
  field: string;
}): void {
  if (input.origins.length === 0 && requireAllowlistFlag(input.envVar)) {
    throw new BadRequestException(
      `${input.errorCode}: this deployment requires at least one entry in \`${input.field}\` (full origin like \`https://app.example.com\`). Add the production and any preview origins before saving.`,
    );
  }
}
