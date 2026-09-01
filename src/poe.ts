// Thin typed layer over the host's poe.* bridge (api.pathofexile.com, called
// by the host with the user's account token). PoE1 only until GGG opens the
// PoE2 stash API.
import type { AddonHost, PoeApiResponse } from './types';

export type PoeBridge = NonNullable<AddonHost['poe']>;

export interface League {
  id: string;
  realm?: string;
}

export interface StashTabMeta {
  id: string;
  parent?: string;
  name: string;
  type: string;
  index?: number;
  children?: StashTabMeta[];
}

export interface StashItem {
  id?: string;
  name?: string;
  typeLine?: string;
  baseType?: string;
  stackSize?: number;
  icon?: string;
  frameType?: number;
  ilvl?: number;
}

function parseBody<T>(res: PoeApiResponse, context: string): T {
  if (res.status === 429) {
    throw new RateLimitError(res.retry_after ?? 10);
  }
  if (res.status !== 200) {
    throw new Error(`${context}: api.pathofexile.com returned HTTP ${res.status}`);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error(`${context}: unexpected response from api.pathofexile.com`);
  }
}

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limited — retry in ${retryAfterSeconds}s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function fetchLeagues(poe: PoeBridge): Promise<League[]> {
  const data = parseBody<{ leagues?: League[] }>(await poe.leagues(), 'leagues');
  return (data.leagues ?? []).filter((l) => !!l.id);
}

/**
 * The current challenge league: the account list leads with Standard,
 * Hardcore and their SSF/Ruthless variants, none of which is what a wealth
 * tracker should open on.
 */
export function defaultLeague(list: string[]): string {
  return (
    list.find(
      (l) => l !== 'Standard' && !l.startsWith('Hardcore') && !/ssf|ruthless|solo|void/i.test(l),
    ) ??
    list[0] ??
    ''
  );
}

/** Flattened tab list — folders are dropped, their children keep `parent`. */
export async function fetchStashTabs(poe: PoeBridge, league: string): Promise<StashTabMeta[]> {
  const data = parseBody<{ stashes?: StashTabMeta[] }>(await poe.stashList(league), 'stash list');
  const out: StashTabMeta[] = [];
  const walk = (tabs: StashTabMeta[]) => {
    for (const tab of tabs) {
      if (tab.type === 'Folder') {
        if (tab.children) walk(tab.children);
        continue;
      }
      out.push(tab);
      if (tab.children) walk(tab.children);
    }
  };
  walk(data.stashes ?? []);
  return out;
}

export async function fetchStashItems(
  poe: PoeBridge,
  league: string,
  tab: StashTabMeta,
): Promise<StashItem[]> {
  const data = parseBody<{ stash?: { items?: StashItem[] } }>(
    await poe.stashTab(league, tab.id, tab.parent ?? null),
    `stash tab ${tab.name}`,
  );
  return data.stash?.items ?? [];
}
