import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const EXPECTED_MEMBER_SURFACE = [
  'v1/conversations GET queue',
  'v1/conversations GET :id',
  'v1/conversations POST :id/messages',
  'v1/conversations POST :id/messages/:messageId/retry-delivery',
  'v1/conversations POST :id/status',
  'v1/conversations POST :id/take-over',
  'v1/conversations POST :id/release',
  'v1/conversations POST :id/clear-draft',
  'v1/conversations POST :id/request-draft',
  'v1/conversations POST :id/attachments/upload-request',
  'v1/conversations POST :id/attachments/:attachmentId/complete',
  'v1/conversations DELETE :id/attachments/:attachmentId',
  'v1/me/memberships <whole controller>',
  'v1/oauth/pending-org <whole controller>',
  'v1/overview GET setup',
];

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
      continue;
    }
    if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function controllerPath(lines: string[]): string {
  for (const line of lines) {
    const hit = /@Controller\(\s*'([^']*)'/.exec(line);
    if (hit) return hit[1]!;
  }
  return '<unknown>';
}

function memberRoutes(source: string): string[] {
  const lines = source.split('\n');
  const base = controllerPath(lines);
  const found: string[] = [];

  lines.forEach((line, index) => {
    if (!line.includes('@AllowMember()')) return;
    for (let i = index - 1; i >= 0; i -= 1) {
      const prev = lines[i]!;
      const route = /@(Get|Post|Patch|Put|Delete)\(\s*'?([^')]*)'?\s*\)/.exec(prev);
      if (route) {
        found.push(`${base} ${route[1]!.toUpperCase()} ${route[2] || '/'}`);
        return;
      }
      if (/^export class/.test(prev) || /@Controller\(/.test(prev)) break;
    }
    found.push(`${base} <whole controller>`);
  });

  return found;
}

describe('the member-reachable control plane is a closed list, because ControlPlaneGuard denies members by default', () => {
  it('only the inbox and the per-user session routes carry @AllowMember() — widening it has to be a deliberate diff here', () => {
    const actual = controllerFiles(SRC_ROOT).flatMap((file) =>
      memberRoutes(readFileSync(file, 'utf8')),
    );
    expect([...actual].sort()).toEqual([...EXPECTED_MEMBER_SURFACE].sort());
  });
});
