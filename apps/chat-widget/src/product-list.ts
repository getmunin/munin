import { formatPriceRange } from '@getmunin/types/message-format';
import type { MessageComponent, ProductListComponent, ProductListItem } from '@getmunin/types';
import type { Strings } from './strings/index.ts';

export function renderMessageComponents(
  components: MessageComponent[] | undefined,
  locale: string,
  strings: Strings,
): HTMLElement[] {
  if (!components?.length) return [];
  const out: HTMLElement[] = [];
  for (const component of components) {
    if (component.type === 'product_list') {
      out.push(renderProductList(component, locale, strings));
    }
  }
  return out;
}

function renderProductList(
  component: ProductListComponent,
  locale: string,
  strings: Strings,
): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'plist-rail';
  for (const item of component.items) {
    rail.appendChild(renderCard(item, locale, strings));
  }
  return rail;
}

function renderCard(item: ProductListItem, locale: string, strings: Strings): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pcard';

  if (item.imageUrl) {
    const img = document.createElement('img');
    img.className = 'pcard-shot';
    img.src = item.imageUrl;
    img.alt = item.title;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.replaceWith(placeholderShot());
    });
    card.appendChild(img);
  } else {
    card.appendChild(placeholderShot());
  }

  const name = document.createElement('div');
  name.className = 'pcard-name';
  name.textContent = item.title;
  card.appendChild(name);

  const price = formatPriceRange(item, locale);
  if (price) {
    const priceEl = document.createElement('div');
    priceEl.className = 'pcard-price';
    priceEl.textContent = price;
    card.appendChild(priceEl);
  }

  if (item.url) {
    const link = document.createElement('a');
    link.className = 'pcard-view';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${strings.productViewLabel} ↗`;
    card.appendChild(link);
  }

  return card;
}

function placeholderShot(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'pcard-shot pcard-shot-empty';
  el.setAttribute('aria-hidden', 'true');
  return el;
}
