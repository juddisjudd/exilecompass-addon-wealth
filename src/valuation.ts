// Pure item valuation against a price book — kept DOM-free so it runs under
// bun. The model follows Sidekick's Wealth Tracker: price what poe.ninja can
// price (currency-like stackables by exact name, uniques by name at the
// cheapest variant), skip the rest (rares, gems, maps) rather than guess.
import type { PriceBook } from './pricing';
import type { StashItem } from './poe';

export interface ValuedItem {
  name: string;
  icon?: string;
  count: number;
  unitChaos: number;
  totalChaos: number;
}

const FRAME_UNIQUE = 3;
const FRAME_RELIC = 9;

export function valueItem(item: StashItem, book: PriceBook): ValuedItem | null {
  const display = item.name?.trim() || item.typeLine?.trim() || '';
  if (!display) return null;
  const count = item.stackSize && item.stackSize > 0 ? item.stackSize : 1;

  let unit: number | undefined;
  if (item.frameType === FRAME_UNIQUE || item.frameType === FRAME_RELIC) {
    unit = book.uniques.get(display.toLowerCase());
  } else {
    // Stackables (currency, cards, essences…) match the exchange tables by
    // exact name; the API puts that name in typeLine, with name empty.
    unit =
      book.exchange.get((item.typeLine ?? '').trim().toLowerCase()) ??
      book.exchange.get(display.toLowerCase());
  }
  if (!unit) return null;

  return {
    name: display,
    icon: item.icon,
    count,
    unitChaos: unit,
    totalChaos: unit * count,
  };
}

export interface TabValuation {
  totalChaos: number;
  items: ValuedItem[];
}

/** Values a tab's items, merging identical names into one row. */
export function valueTab(items: StashItem[], book: PriceBook): TabValuation {
  const merged = new Map<string, ValuedItem>();
  for (const item of items) {
    const valued = valueItem(item, book);
    if (!valued) continue;
    const existing = merged.get(valued.name);
    if (existing) {
      existing.count += valued.count;
      existing.totalChaos += valued.totalChaos;
    } else {
      merged.set(valued.name, valued);
    }
  }
  const list = [...merged.values()].sort((a, b) => b.totalChaos - a.totalChaos);
  return { totalChaos: list.reduce((sum, i) => sum + i.totalChaos, 0), items: list };
}

export function formatChaos(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return `${Math.round(v).toLocaleString('en-US')}`;
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (v >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
  return v.toPrecision(2).replace(/\.?0+$/, '');
}
