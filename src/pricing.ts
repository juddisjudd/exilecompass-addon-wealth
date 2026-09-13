// poe.ninja price book for a league: chaos values matched by exact item name
// (exchange tables) or unique name at the cheapest variant, plus poe.ninja's
// 7-day change and a category label per priced name. Each table is disk-cached
// by the host for an hour, so a snapshot costs at most one download per
// category per hour.
import type { AddonHost } from './types';

type Net = NonNullable<AddonHost['net']>;

const NINJA = 'https://poe.ninja';
const TABLE_TTL_SECONDS = 60 * 60;

// Exchange overviews: value in chaos, matched by exact item name.
const EXCHANGE_TYPES = [
  'Currency',
  'Fragment',
  'Scarab',
  'DivinationCard',
  'Essence',
  'Oil',
  'Tattoo',
  'Runegraft',
  'Fossil',
  'Resonator',
  'DeliriumOrb',
  'Omen',
  'Artifact',
  'AllflameEmber',
  'Ducat',
  'Astrolabe',
  'EnshroudingCrystal',
];

// Item overviews: uniques matched by name (cheapest variant — conservative
// for links/corruption variants we can't distinguish cheaply).
const UNIQUE_TYPES = [
  'UniqueWeapon',
  'UniqueArmour',
  'UniqueAccessory',
  'UniqueFlask',
  'UniqueJewel',
  'UniqueRelic',
  'UniqueTincture',
];

const CATEGORY_LABELS: Record<string, string> = {
  Currency: 'Currency',
  Fragment: 'Fragments',
  Scarab: 'Scarabs',
  DivinationCard: 'Div Cards',
  Essence: 'Essences',
  Oil: 'Oils',
  Tattoo: 'Tattoos',
  Runegraft: 'Runegrafts',
  Fossil: 'Fossils',
  Resonator: 'Resonators',
  DeliriumOrb: 'Delirium',
  Omen: 'Omens',
  Artifact: 'Artifacts',
  AllflameEmber: 'Embers',
  Ducat: 'Ducats',
  Astrolabe: 'Astrolabes',
  EnshroudingCrystal: 'Crystals',
};

export interface PriceMeta {
  /** 7-day change percentage from poe.ninja's sparkline. */
  change?: number;
  category: string;
}

export interface PriceBook {
  league: string;
  /** Exact item name (lowercased) → chaos value, for currency-like items. */
  exchange: Map<string, number>;
  /** Unique name (lowercased) → cheapest chaos value across variants. */
  uniques: Map<string, number>;
  meta: Map<string, PriceMeta>;
  /** Chaos per divine, for display conversion (0 when unknown). */
  divineChaos: number;
}

async function getJson<T>(net: Net, url: string): Promise<T | null> {
  try {
    const res = net.fetchCached
      ? await net.fetchCached(url, TABLE_TTL_SECONDS)
      : await net.fetch(url);
    if (res.status !== 200) return null;
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

interface ExchangeOverview {
  core?: { items?: { id: string; name: string }[]; primary?: string };
  lines?: { id: string; primaryValue: number; sparkline?: { totalChange?: number } }[];
  items?: { id: string; name: string }[];
}

interface ItemOverview {
  lines?: { name: string; chaosValue?: number; sparkLine?: { totalChange?: number } }[];
}

export async function loadPriceBook(net: Net, league: string): Promise<PriceBook> {
  const book: PriceBook = {
    league,
    exchange: new Map(),
    uniques: new Map(),
    meta: new Map(),
    divineChaos: 0,
  };
  const leagueParam = encodeURIComponent(league);

  await Promise.all([
    ...EXCHANGE_TYPES.map(async (type) => {
      const data = await getJson<ExchangeOverview>(
        net,
        `${NINJA}/poe1/api/economy/exchange/current/overview?league=${leagueParam}&type=${type}`,
      );
      if (!data) return;
      const names = new Map<string, string>();
      for (const item of [...(data.core?.items ?? []), ...(data.items ?? [])]) {
        names.set(item.id, item.name);
      }
      for (const line of data.lines ?? []) {
        if (typeof line.primaryValue !== 'number' || line.primaryValue <= 0) continue;
        const name = names.get(line.id);
        if (!name) continue;
        const key = name.toLowerCase();
        book.exchange.set(key, line.primaryValue);
        book.meta.set(key, {
          change: line.sparkline?.totalChange,
          category: CATEGORY_LABELS[type] ?? type,
        });
      }
    }),
    ...UNIQUE_TYPES.map(async (type) => {
      const data = await getJson<ItemOverview>(
        net,
        `${NINJA}/poe1/api/economy/stash/current/item/overview?league=${leagueParam}&type=${type}`,
      );
      if (!data) return;
      for (const line of data.lines ?? []) {
        if (typeof line.chaosValue !== 'number' || line.chaosValue <= 0) continue;
        const key = line.name.toLowerCase();
        const existing = book.uniques.get(key);
        if (existing === undefined || line.chaosValue < existing) {
          book.uniques.set(key, line.chaosValue);
          book.meta.set(key, {
            change: line.sparkLine?.totalChange,
            category: 'Uniques',
          });
        }
      }
    }),
  ]);

  book.divineChaos = book.exchange.get('divine orb') ?? 0;
  return book;
}
