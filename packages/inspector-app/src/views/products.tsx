import { useState } from 'react';
import { formatPriceRange } from '@getmunin/types/message-format';
import type { CommerceProduct, ProductSearchResult } from '../types';
import { Chrome } from '../chrome';
import { useI18n } from '../i18n';

export function ProductsView({ initial }: { initial: ProductSearchResult }) {
  const { t, locale } = useI18n();
  const { connection, products } = initial;

  return (
    <Chrome context={t('chrome.contextCommerce')} tool="commerce_search_products">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">{t('products.eyebrow')}</div>
          <h1 className="ledger-title">{t('products.title')}</h1>
          <p className="subline">
            {t('products.subline', { count: products.length, source: connection.name })}
          </p>
        </div>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard key={product.productRef} product={product} locale={locale} viewLabel={t('products.view')} />
        ))}
      </div>
      <div className="ledger-foot">
        {t('products.foot', { vendor: connection.vendor })}
      </div>
    </Chrome>
  );
}

function ProductCard({
  product,
  locale,
  viewLabel,
}: {
  product: CommerceProduct;
  locale: string;
  viewLabel: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const price = formatPriceRange(product, locale);
  const showImage = isHttps(product.imageUrl) && !imageFailed;

  return (
    <div className="product-card">
      {showImage ? (
        <img
          className="product-shot"
          src={product.imageUrl!}
          alt={product.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="product-shot product-shot-empty" aria-hidden="true" />
      )}
      <span className="product-name">{product.title}</span>
      {price !== null && <span className="product-price">{price}</span>}
      {isHttps(product.url) && (
        <a className="product-view" href={product.url!} target="_blank" rel="noreferrer">
          {viewLabel}
        </a>
      )}
    </div>
  );
}

function isHttps(url: string | null): boolean {
  return typeof url === 'string' && /^https:\/\//i.test(url);
}
