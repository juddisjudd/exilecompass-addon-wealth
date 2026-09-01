import type { MountFn, PoeStatus } from './types';
import {
  defaultLeague,
  fetchLeagues,
  fetchStashItems,
  fetchStashTabs,
  RateLimitError,
  type StashTabMeta,
} from './poe';
import { loadPriceBook } from './pricing';
import { compareItems, formatChaos, valueTab, type SortKey, type ValuedItem } from './valuation';
import { appendSnapshot, sparklinePoints, type Snapshot } from './history';

const SETTINGS_URL = 'https://exilecompass.com/settings';
// Add-on storage shares the app's settings file, so the stored item list stays
// modest; the table itself shows everything stored.
const ITEMS_CAP = 250;
const MAX_ROWS = 100;
// Courtesy gap between stash requests — GGG's stash endpoint is one of the
// most tightly rate-limited APIs, and a snapshot walks many tabs.
const TAB_FETCH_GAP_MS = 400;

const CSS = `
  .wl { display:flex; flex-direction:column; height:100%; gap:6px; font-size:11px; }
  .wl-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:0 0 auto; }
  .wl select, .wl input, .wl button { font:inherit; color:var(--c-primary); background:#121214;
    border:1px solid rgba(167,154,133,.34); padding:3px 6px; }
  .wl button { cursor:pointer; }
  .wl button:hover:not(:disabled) { border-color:rgba(237,230,213,.5); }
  .wl button:disabled { opacity:.4; cursor:default; }
  .wl-status { margin-left:auto; font-size:10px; color:var(--c-accent); }
  .wl-error { color:#e2333c; font-size:10.5px; flex:0 0 auto; }
  .wl-note { color:var(--c-accent); font-size:10.5px; flex:0 0 auto; line-height:1.5; }
  .wl-link { color:#e2b657; cursor:pointer; text-decoration:underline; }
  .wl-empty { padding:12px 6px; color:var(--c-accent); font-style:italic; }
  .wl-total { display:flex; align-items:baseline; gap:10px; flex:0 0 auto; padding:6px 0 0; }
  .wl-total-main { font-size:20px; font-weight:700; color:var(--c-primary); }
  .wl-total-div { font-size:12px; color:var(--c-accent); }
  .wl-cats { display:flex; flex-wrap:wrap; gap:4px; flex:0 0 auto; }
  .wl-cat { display:inline-flex; align-items:center; gap:5px; border:1px solid rgba(167,154,133,.28);
    background:rgba(167,154,133,.07); padding:1px 7px; font-size:10px; }
  .wl-cat-name { color:var(--c-accent); }
  .wl-cat-val { color:var(--c-primary); font-variant-numeric:tabular-nums; }
  .wl-spark { flex:0 0 auto; }
  .wl-spark svg { display:block; width:100%; height:36px; }
  .wl-search { width:100%; box-sizing:border-box; flex:0 0 auto; }
  .wl-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column;
    gap:8px; scrollbar-width:none; }
  .wl-scroll::-webkit-scrollbar { display:none; }
  .wl-section { font-size:9.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
    color:var(--c-accent); padding:2px 0; }
  .wl-tabs { display:flex; flex-direction:column; border:1px solid rgba(167,154,133,.18); }
  .wl-tabrow { display:flex; align-items:center; gap:6px; padding:3px 6px;
    border-bottom:1px solid rgba(167,154,133,.1); }
  .wl-tabrow:last-child { border-bottom:none; }
  .wl-tabrow label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    cursor:pointer; }
  .wl-tabtype { font-size:9.5px; color:var(--c-accent); }
  .wl-tabval { font-variant-numeric:tabular-nums; color:var(--c-primary); }
  .wl-items { display:flex; flex-direction:column; border:1px solid rgba(167,154,133,.18); }
  .wl-head { display:grid; grid-template-columns:18px minmax(0,1fr) 34px 44px 64px; gap:6px;
    padding:3px 6px; border-bottom:1px solid rgba(167,154,133,.22); background:rgba(167,154,133,.05); }
  .wl-sort { background:none !important; border:none !important; padding:0 !important;
    font-size:9.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
    color:var(--c-accent) !important; text-align:left; }
  .wl-sort.num { text-align:right; }
  .wl-sort.on, .wl-sort:hover { color:var(--c-primary) !important; }
  .wl-item { display:grid; grid-template-columns:18px minmax(0,1fr) 34px 44px 64px; gap:6px;
    align-items:center; padding:3px 6px; border-bottom:1px solid rgba(167,154,133,.1); }
  .wl-item:last-child { border-bottom:none; }
  .wl-item img { width:18px; height:18px; object-fit:contain; }
  .wl-item-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .wl-item-count { color:var(--c-accent); font-size:10px; text-align:right;
    font-variant-numeric:tabular-nums; }
  .wl-chg { font-size:10px; text-align:right; font-variant-numeric:tabular-nums; }
  .wl-up { color:#5fa372; }
  .wl-down { color:#e2333c; }
  .wl-item-val { font-variant-numeric:tabular-nums; font-weight:600; text-align:right; }
  .wl-foot { flex:0 0 auto; font-size:9.5px; color:var(--c-accent); display:flex;
    justify-content:space-between; gap:8px; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TabResult {
  id: string;
  name: string;
  chaos: number;
}

interface WealthItem extends ValuedItem {
  tabs?: string[];
}

interface LastRun {
  ts: number;
  totalChaos: number;
  divineChaos: number;
  perTab: TabResult[];
  items: WealthItem[];
  categories: { name: string; chaos: number }[];
  /** Pre-0.2.0 records stored a top list instead of the full item list. */
  top?: WealthItem[];
}

interface State {
  poeStatus: PoeStatus | null;
  leagues: string[];
  league: string;
  tabs: StashTabMeta[];
  selected: Set<string>;
  showTabs: boolean;
  last: LastRun | null;
  history: Snapshot[];
  running: boolean;
  progress: string;
  error: string;
  query: string;
  sortKey: SortKey;
  sortDir: 1 | -1;
}

const mount: MountFn = async ({ root, host }) => {
  root.innerHTML = '';
  const style = el('style');
  style.textContent = CSS;
  root.append(style);

  if (!host.poe || !host.net) {
    root.append(
      el('p', 'wl-error', 'This add-on needs a newer ExileCompass (the host must provide PoE account access).'),
    );
    return;
  }
  const poe = host.poe;
  const net = host.net;

  const state: State = {
    poeStatus: null,
    leagues: [],
    league: '',
    tabs: [],
    selected: new Set(),
    showTabs: false,
    last: null,
    history: [],
    running: false,
    progress: '',
    error: '',
    query: '',
    sortKey: 'total',
    sortDir: -1,
  };

  const readJson = async <T>(key: string): Promise<T | null> => {
    const raw = await host.storage.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  const writeJson = (key: string, value: unknown) => host.storage.set(key, JSON.stringify(value));

  // ── data loading ─────────────────────────────────────────────────────────
  async function loadLeagueState(): Promise<void> {
    state.selected = new Set((await readJson<string[]>(`tabs:${state.league}`)) ?? []);
    const last = await readJson<LastRun>(`last:${state.league}`);
    if (last) {
      last.items = last.items ?? last.top ?? [];
      last.categories = last.categories ?? [];
    }
    state.last = last;
    state.history = (await readJson<Snapshot[]>(`history:${state.league}`)) ?? [];
    state.tabs = [];
    state.query = '';
  }

  async function loadTabs(): Promise<void> {
    state.error = '';
    try {
      state.tabs = await fetchStashTabs(poe, state.league);
      // First visit to a league: nothing tracked yet, so open the picker.
      if (state.selected.size === 0) state.showTabs = true;
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
  }

  async function init(): Promise<void> {
    try {
      state.poeStatus = await poe.status();
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      render();
      return;
    }
    if (!state.poeStatus.appLinked || !state.poeStatus.poeLinked || state.poeStatus.poeExpired) {
      render();
      return;
    }
    try {
      const leagues = await fetchLeagues(poe);
      state.leagues = leagues.map((l) => l.id);
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    const saved = await host.storage.get('league');
    state.league =
      saved && state.leagues.includes(saved) ? saved : defaultLeague(state.leagues);
    await loadLeagueState();
    render();
    if (state.league) {
      await loadTabs();
      render();
    }
  }

  // ── snapshot run ─────────────────────────────────────────────────────────
  async function snapshot(): Promise<void> {
    if (state.running || state.selected.size === 0) return;
    state.running = true;
    state.error = '';
    const selectedTabs = state.tabs.filter((t) => state.selected.has(t.id));
    try {
      state.progress = 'prices…';
      render();
      const book = await loadPriceBook(net, state.league);

      const perTab: TabResult[] = [];
      const merged = new Map<string, WealthItem>();
      for (let i = 0; i < selectedTabs.length; i += 1) {
        const tab = selectedTabs[i];
        state.progress = `${tab.name} (${i + 1}/${selectedTabs.length})`;
        render();
        let items;
        try {
          items = await fetchStashItems(poe, state.league, tab);
        } catch (e) {
          if (e instanceof RateLimitError) {
            state.progress = `rate limited — waiting ${e.retryAfterSeconds}s`;
            render();
            await sleep(e.retryAfterSeconds * 1000);
            items = await fetchStashItems(poe, state.league, tab);
          } else {
            throw e;
          }
        }
        const valued = valueTab(items, book);
        perTab.push({ id: tab.id, name: tab.name, chaos: valued.totalChaos });
        for (const item of valued.items) {
          const existing = merged.get(item.name);
          if (existing) {
            existing.count += item.count;
            existing.totalChaos += item.totalChaos;
            if (!existing.tabs!.includes(tab.name)) existing.tabs!.push(tab.name);
          } else {
            merged.set(item.name, { ...item, tabs: [tab.name] });
          }
        }
        if (i < selectedTabs.length - 1) await sleep(TAB_FETCH_GAP_MS);
      }

      const items = [...merged.values()]
        .sort((a, b) => b.totalChaos - a.totalChaos)
        .slice(0, ITEMS_CAP);
      const byCategory = new Map<string, number>();
      for (const item of merged.values()) {
        const cat = item.category ?? 'Other';
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + item.totalChaos);
      }
      const categories = [...byCategory.entries()]
        .map(([name, chaos]) => ({ name, chaos }))
        .sort((a, b) => b.chaos - a.chaos);
      const totalChaos = perTab.reduce((sum, t) => sum + t.chaos, 0);

      state.last = { ts: Date.now(), totalChaos, divineChaos: book.divineChaos, perTab, items, categories };
      state.history = appendSnapshot(state.history, {
        ts: Date.now(),
        totalChaos,
        divineChaos: book.divineChaos,
      });
      await writeJson(`last:${state.league}`, state.last);
      await writeJson(`history:${state.league}`, state.history);
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      state.running = false;
      state.progress = '';
      render();
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────
  const shell = el('div', 'wl');
  root.append(shell);

  const iconCache = new Map<string, Promise<string>>();
  function resolveIcon(url: string): Promise<string> {
    if (!net.fetchImage) return Promise.resolve(url);
    let p = iconCache.get(url);
    if (!p) {
      p = net.fetchImage(url).catch(() => url);
      iconCache.set(url, p);
    }
    return p;
  }

  function ago(ts: number): string {
    const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }

  function settingsLink(text: string): HTMLElement {
    const link = el('span', 'wl-link', text);
    link.addEventListener('click', () => void host.shell?.openExternal(SETTINGS_URL));
    return link;
  }

  function setSort(key: SortKey): void {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 1 ? -1 : 1;
    } else {
      state.sortKey = key;
      state.sortDir = key === 'name' ? 1 : -1;
    }
    render();
  }

  function render(): void {
    shell.innerHTML = '';

    // Gate states first: not signed in / no PoE / expired.
    const status = state.poeStatus;
    if (status && (!status.appLinked || !status.poeLinked || status.poeExpired)) {
      if (!status.appLinked) {
        shell.append(
          el('p', 'wl-note', 'Sign in to your ExileCompass account under Settings → Account to use the wealth tracker.'),
        );
      } else {
        const note = el('p', 'wl-note');
        note.append(
          status.poeExpired
            ? 'Your Path of Exile connection expired. '
            : 'No Path of Exile account is connected yet. ',
          settingsLink('Connect it at exilecompass.com/settings'),
          ', then reopen this panel.',
        );
        shell.append(note);
      }
      if (state.error) shell.append(el('p', 'wl-error', state.error));
      return;
    }

    const bar = el('div', 'wl-bar');
    const leagueSel = el('select');
    for (const league of state.leagues.length ? state.leagues : [state.league]) {
      const opt = el('option', undefined, league);
      opt.value = league;
      opt.selected = league === state.league;
      leagueSel.append(opt);
    }
    leagueSel.disabled = state.running;
    leagueSel.addEventListener('change', () => {
      state.league = leagueSel.value;
      void host.storage.set('league', state.league).then(async () => {
        await loadLeagueState();
        render();
        await loadTabs();
        render();
      });
    });
    bar.append(leagueSel);

    const tabsBtn = el('button', undefined, `Tabs (${state.selected.size})`);
    tabsBtn.type = 'button';
    tabsBtn.disabled = state.running;
    tabsBtn.addEventListener('click', () => {
      state.showTabs = !state.showTabs;
      render();
    });
    bar.append(tabsBtn);

    const snap = el('button', undefined, state.running ? 'Running…' : 'Snapshot');
    snap.type = 'button';
    snap.disabled = state.running || state.selected.size === 0;
    snap.title =
      state.selected.size === 0 ? 'Pick stash tabs to track first' : 'Fetch and value the selected tabs';
    snap.addEventListener('click', () => void snapshot());
    bar.append(snap);

    bar.append(
      el('span', 'wl-status', state.running ? state.progress : state.last ? `updated ${ago(state.last.ts)}` : ''),
    );
    shell.append(bar);

    if (state.error) shell.append(el('div', 'wl-error', state.error));

    if (state.last) {
      const total = el('div', 'wl-total');
      total.append(el('span', 'wl-total-main', `${formatChaos(state.last.totalChaos)} c`));
      if (state.last.divineChaos > 0) {
        total.append(
          el('span', 'wl-total-div', `≈ ${formatChaos(state.last.totalChaos / state.last.divineChaos)} div`),
        );
      }
      shell.append(total);

      if (state.last.categories.length) {
        const cats = el('div', 'wl-cats');
        for (const cat of state.last.categories) {
          const chip = el('span', 'wl-cat');
          chip.append(el('span', 'wl-cat-name', cat.name), el('span', 'wl-cat-val', `${formatChaos(cat.chaos)} c`));
          cats.append(chip);
        }
        shell.append(cats);
      }
    }

    if (state.history.length >= 2) {
      const spark = el('div', 'wl-spark');
      const points = sparklinePoints(state.history, 300, 36);
      spark.innerHTML = `<svg viewBox="0 0 300 36" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#5fa372" stroke-width="1.5"/></svg>`;
      shell.append(spark);
    }

    const scroll = el('div', 'wl-scroll');
    shell.append(scroll);

    if (state.showTabs) {
      scroll.append(el('div', 'wl-section', 'Tracked stash tabs'));
      const list = el('div', 'wl-tabs');
      if (state.tabs.length === 0) {
        list.append(el('div', 'wl-empty', state.error ? 'Could not load stash tabs.' : 'Loading stash tabs…'));
      }
      for (const tab of state.tabs) {
        const row = el('div', 'wl-tabrow');
        const box = el('input');
        box.type = 'checkbox';
        box.id = `wl-tab-${tab.id}`;
        box.checked = state.selected.has(tab.id);
        box.disabled = state.running;
        box.addEventListener('change', () => {
          if (box.checked) state.selected.add(tab.id);
          else state.selected.delete(tab.id);
          void writeJson(`tabs:${state.league}`, [...state.selected]);
          render();
        });
        const label = el('label', undefined, tab.name);
        label.htmlFor = box.id;
        label.append(' ', el('span', 'wl-tabtype', tab.type.replace(/Stash$/, '')));
        row.append(box, label);
        list.append(row);
      }
      scroll.append(list);
    }

    if (state.last) {
      scroll.append(el('div', 'wl-section', 'Per tab'));
      const tabs = el('div', 'wl-tabs');
      for (const tab of [...state.last.perTab].sort((a, b) => b.chaos - a.chaos)) {
        const row = el('div', 'wl-tabrow');
        row.append(el('label', undefined, tab.name), el('span', 'wl-tabval', `${formatChaos(tab.chaos)} c`));
        tabs.append(row);
      }
      scroll.append(tabs);

      scroll.append(el('div', 'wl-section', `Items (${state.last.items.length})`));

      const search = el('input', 'wl-search');
      search.type = 'search';
      search.placeholder = 'Search items…';
      search.value = state.query;
      search.spellcheck = false;
      search.addEventListener('input', () => {
        state.query = search.value;
        renderItems();
      });
      scroll.append(search);

      const items = el('div', 'wl-items');
      scroll.append(items);

      const renderItems = () => {
        items.innerHTML = '';

        const head = el('div', 'wl-head');
        head.append(el('span'));
        const cols: { key: SortKey; label: string; cls: string }[] = [
          { key: 'name', label: 'Name', cls: '' },
          { key: 'qty', label: 'Qty', cls: 'num' },
          { key: 'change', label: '7d', cls: 'num' },
          { key: 'total', label: 'Total', cls: 'num' },
        ];
        for (const col of cols) {
          const btn = el('button', `wl-sort ${col.cls}${state.sortKey === col.key ? ' on' : ''}`);
          btn.type = 'button';
          btn.textContent =
            state.sortKey === col.key ? `${col.label} ${state.sortDir === 1 ? '▲' : '▼'}` : col.label;
          btn.addEventListener('click', () => setSort(col.key));
          head.append(btn);
        }
        items.append(head);

        const q = state.query.trim().toLowerCase();
        const list = (state.last?.items ?? [])
          .filter((i) => !q || i.name.toLowerCase().includes(q))
          .sort(compareItems(state.sortKey, state.sortDir));

        for (const item of list.slice(0, MAX_ROWS)) {
          const row = el('div', 'wl-item');
          const iconCell = el('div');
          if (item.icon) {
            const img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = () => img.remove();
            void resolveIcon(item.icon).then((src) => {
              img.src = src;
            });
            iconCell.append(img);
          }
          const name = el('span', 'wl-item-name', item.name);
          const tabNames = item.tabs?.length ? ` — ${item.tabs.join(', ')}` : '';
          name.title = `${item.name} · ${formatChaos(item.unitChaos)} c each${tabNames}`;

          const chg = el('span', 'wl-chg');
          if (typeof item.change === 'number' && item.change !== 0) {
            chg.textContent = `${item.change > 0 ? '+' : ''}${item.change.toFixed(1)}%`;
            chg.classList.add(item.change > 0 ? 'wl-up' : 'wl-down');
          }

          row.append(
            iconCell,
            name,
            el('span', 'wl-item-count', item.count > 1 ? `×${item.count}` : ''),
            chg,
            el('span', 'wl-item-val', `${formatChaos(item.totalChaos)} c`),
          );
          items.append(row);
        }
        if (list.length === 0) items.append(el('div', 'wl-empty', 'Nothing matches.'));
        if (list.length > MAX_ROWS) {
          items.append(el('div', 'wl-empty', `Showing ${MAX_ROWS} of ${list.length} — narrow the search to see the rest.`));
        }
      };
      renderItems();
    } else if (!state.showTabs) {
      scroll.append(
        el('div', 'wl-empty', 'Pick the stash tabs to track, then take a snapshot to value them.'),
      );
    }

    const foot = el('div', 'wl-foot');
    foot.append(
      el('span', undefined, 'PoE1 stashes · Prices by poe.ninja · rares/gems/maps not counted'),
      el('span', undefined, state.poeStatus?.poeName ?? ''),
    );
    shell.append(foot);
  }

  render();
  await init();
};

export default mount;
