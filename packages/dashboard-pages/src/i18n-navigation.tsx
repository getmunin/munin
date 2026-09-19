'use client';

import { forwardRef, useCallback, useMemo, type ComponentProps } from 'react';
import { orgDashboardPath, stripOrgDashboardPath } from '@getmunin/types';
import {
  Link as BaseLink,
  usePathname as useBasePathname,
  useRouter as useBaseRouter,
} from './navigation-routing';
import { readRouteOrgId, useRouteOrgId } from './org-route';

export function orgHref(path: string, orgId: string | null = readRouteOrgId()): string {
  return orgId ? orgDashboardPath(path, orgId) : path;
}

type BaseLinkProps = ComponentProps<typeof BaseLink>;

export const Link = forwardRef<HTMLAnchorElement, BaseLinkProps>(function Link(props, ref) {
  const orgId = useRouteOrgId();
  const href = typeof props.href === 'string' ? orgHref(props.href, orgId) : props.href;
  return <BaseLink {...props} href={href} ref={ref} />;
});

export function usePathname(): string {
  return stripOrgDashboardPath(useBasePathname());
}

export function useScopedPathname(): string {
  return useBasePathname();
}

export function useOrgHref(): (path: string) => string {
  const orgId = useRouteOrgId();
  return useCallback((path: string) => orgHref(path, orgId), [orgId]);
}

type BaseRouter = ReturnType<typeof useBaseRouter>;
type RouterHref = Parameters<BaseRouter['push']>[0];

export function useRouter(): BaseRouter {
  const router = useBaseRouter();
  const orgId = useRouteOrgId();
  return useMemo(() => {
    const scope =
      <A extends unknown[], R>(fn: (href: RouterHref, ...rest: A) => R) =>
      (href: RouterHref, ...rest: A): R =>
        fn(typeof href === 'string' ? orgHref(href, orgId) : href, ...rest);
    return {
      ...router,
      push: scope(router.push),
      replace: scope(router.replace),
      prefetch: scope(router.prefetch),
    };
  }, [router, orgId]);
}
