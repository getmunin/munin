'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';
import { Link } from '../i18n-navigation';

export function BrandMark({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} aria-label={label} className="block shrink-0">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={label} className="block shrink-0">
      {children}
    </Link>
  );
}

export interface BrandHeadProps {
  brand: string;
  brandHref: string;
  logoSrc: string;
  logoSize: number;
  logoClassName: string;
  headSlot?: ReactNode;
  brandClassName: string;
}

export function BrandHead({
  brand,
  brandHref,
  logoSrc,
  logoSize,
  logoClassName,
  headSlot,
  brandClassName,
}: BrandHeadProps) {
  return (
    <>
      <BrandMark href={brandHref} label={brand}>
        <Image
          src={logoSrc}
          alt=""
          aria-hidden
          width={logoSize}
          height={logoSize}
          className={cn('block object-contain', logoClassName)}
        />
      </BrandMark>
      {headSlot ? (
        <div className="min-w-0">{headSlot}</div>
      ) : (
        <span className={cn('min-w-0 truncate', brandClassName)}>{brand}</span>
      )}
    </>
  );
}
