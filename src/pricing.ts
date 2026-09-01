// poe.ninja price book for a league: one map of item name → chaos value,
// built from the exchange categories (stackables) plus the unique item
// overviews. Same endpoints the Economy add-on uses; each table is disk-cached
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
];

// Item overviews: uniques matched by name (cheapest variant — conservative
// for links/corruption variants we can't distinguish cheaply).
const UNIQUE_TYPES = [
  'UniqueWeapon',
  'UniqueArmour',
  'UniqueAccessory',
  'UniqueFlask',
  'UniqueJewel',
];

export interface PriceBook {
  league: string;
  /** Exact item name (lowercased) → chaos value, for currency-like items. */
  exchange: Map<string, number>;
  /** Unique name (lowercased) → cheapest chaos value across variants. */
  uniques: Map<string, number>;
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
  lines?: { id: string; primaryValue: number }[];
  items?: { id: string; name: string }[];
}

interface ItemOverview {
  lines?: { name: string; chaosValue?: number; links?: number }[];
}

export async function loadPriceBook(net: Net, league: string): Promise<PriceBook> {
  const book: PriceBook = { league, exchange: new Map(), uniques: new Map(), divineChaos: 0 };
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
        if (name) book.exchange.set(name.toLowerCase(), line.primaryValue);
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
        }
      }
    }),
  ]);

  book.divineChaos = book.exchange.get('divine orb') ?? 0;
  return book;
}
