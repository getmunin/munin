import type { ReactNode } from 'react';
import { Button } from '@getmunin/ui';
import { stripTrailingSlashes } from '@getmunin/types';
import { Link } from '../../i18n-navigation';

const DOCS_HOST = stripTrailingSlashes(process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3000/docs');

export const MCP_ENDPOINT = stripTrailingSlashes(process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp');

export function mcpEndpoint(setup: { mcpUrl: string | null }): string {
  return setup.mcpUrl ?? MCP_ENDPOINT;
}

export const FIRST_RUN_ROUTES = {
  channels: '/dashboard/settings/channels',
} as const;

export const FIRST_RUN_DOCS = {
  connectClient: `${DOCS_HOST}/guides`,
} as const;

export function FirstRunLink({
  href,
  accent,
  children,
}: {
  href: string;
  accent?: boolean;
  children: ReactNode;
}) {
  const variant = accent ? 'accentOutline' : 'outline';
  if (href.startsWith('http')) {
    return (
      <Button
        variant={variant}
        render={<a href={href} target="_blank" rel="noreferrer noopener" />}
      >
        {children}
      </Button>
    );
  }
  return (
    <Button variant={variant} render={<Link href={href} />}>
      {children}
    </Button>
  );
}
