import type { ReactNode } from 'react';
import { Button } from '@getmunin/ui';
import { Link } from '../../i18n-navigation';
import { DEFAULT_DOCS_HOST, DEFAULT_MCP_HOST } from '../../data/mcp-setups';

export const MCP_ENDPOINT = DEFAULT_MCP_HOST;

export const FIRST_RUN_ROUTES = {
  channels: '/dashboard/settings/channels',
} as const;

export const FIRST_RUN_DOCS = {
  connectClient: `${DEFAULT_DOCS_HOST}/guides`,
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
