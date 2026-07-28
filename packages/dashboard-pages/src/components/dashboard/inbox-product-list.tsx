'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatPriceRange } from '@getmunin/types/message-format';
import { parseMessageComponents, type ProductListComponent, type ProductListItem } from '@getmunin/types';
import { cn } from '@getmunin/ui';

export function MessageComponents({ metadata }: { metadata: Record<string, unknown> }) {
  const components = parseMessageComponents(metadata.components);
  if (!components) return null;
  return (
    <div className="flex max-w-full flex-col items-end gap-3">
      {components.map((component, index) =>
        component.type === 'product_list' ? (
          <ProductList key={`${component.source.connectionId}-${index}`} component={component} />
        ) : null,
      )}
    </div>
  );
}

function ProductList({ component }: { component: ProductListComponent }) {
  const t = useTranslations('dashboard.overview.drawer');
  return (
    <div className="flex max-w-full gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {component.items.map((item) => (
        <ProductCard key={item.productRef} item={item} viewLabel={t('productsView')} />
      ))}
    </div>
  );
}

function ProductCard({ item, viewLabel }: { item: ProductListItem; viewLabel: string }) {
  const locale = useLocale();
  const [imageFailed, setImageFailed] = useState(false);
  const price = formatPriceRange(item, locale);
  const showImage = item.imageUrl !== null && !imageFailed;

  return (
    <div className="flex w-[132px] shrink-0 flex-col gap-1.5 rounded-bubble border-[1px] border-rule-soft p-1.5 dark:border-rule-on-dark">
      {showImage ? (
        <img
          src={item.imageUrl!}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="aspect-square w-full rounded-[6px] bg-white object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'aspect-square w-full rounded-[6px] bg-paper-deep dark:bg-secondary',
            '[background-image:repeating-linear-gradient(-45deg,transparent,transparent_6px,currentColor_6px,currentColor_7px)]',
            'text-ink-mute/25',
          )}
        />
      )}
      <span className="line-clamp-2 text-xs leading-tight" title={item.title}>
        {item.title}
      </span>
      {price !== null && <span className="font-mono text-[11px] text-ink-mute">{price}</span>}
      {item.url !== null && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute underline underline-offset-2 hover:text-ink"
        >
          {viewLabel} ↗
        </a>
      )}
    </div>
  );
}
