import type { MountFn, PoeStatus } from './types';
import { fetchLeagues, fetchStashItems, fetchStashTabs, RateLimitError, type StashTabMeta } from './poe';
import { loadPriceBook } from './pricing';
import { formatChaos, valueTab, type ValuedItem } from './valuation';
import { appendSnapshot, sparklinePoints, type Snapshot } from './history';

const SETTINGS_URL = 'https://exilecompass.com/settings';
const TOP_ITEMS = 25;
// Courtesy gap between stash requests — GGG's stash endpoint is one of the
// most tightly rate-limited APIs, and a snapshot walks many tabs.
const TAB_FETCH_GAP_MS = 400;

const CSS = `
  .wl { display:flex; flex-direction:column; height:100%; gap:6px; font-size:11px; }
  .wl-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:0 0 auto; }
  .wl select, .wl button { font:inherit; color:var(--c-primary); background:#121214;
    border:1px solid rgba(167,154,133,.34); padding:3px 6px; }
  .wl button { cursor:pointer; }
  .wl button:hover:not(:disabled) { border-color:rgba(237,230,213,.5); }
  .wl button:disabled { opacity:.4; cursor:default; }
  .wl-status { margin-left:auto; font-size:10px; color:var(--c-accent); }
  .wl-error { color:#e2333c; font-size:10.5px; flex:0 0 auto; }
  .wl-note { color:var(--c-accent); font-size:10.5px; flex:0 0 auto; line-height:1.5; }
  .wl-link { color:#e2b657; cursor:pointer; text-decoration:underline; }
  .wl-empty { padding:12px 6px; color:var(--c-accent); font-style:italic; }
  .wl-total { display:flex; align-items:baseline; gap:10px; flex:0 0 auto; padding:6px 0 2px; }
  .wl-total-main { font-size:20px; font-weight:700; color:var(--c-primary); }
  .wl-total-div { font-size:12px; color:var(--c-accent); }
  .wl-spark { flex:0 0 auto; }
  .wl-spark svg { display:block; width:100%; height:36px; }
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
  .wl-item { display:grid; grid-template-columns:18px minmax(0,1fr) auto auto; gap:6px;
    align-items:center; padding:3px 6px; border-bottom:1px solid rgba(167,154,133,.1); }
  .wl-item:last-child { border-bottom:none; }
  .wl-item img { width:18px; height:18px; object-fit:contain; }
  .wl-item-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .wl-item-count { color:var(--c-accent); font-size:10px; }
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

interface LastRun {
  ts: number;
  totalChaos: number;
  divineChaos: number;
  perTab: TabResult[];
  top: ValuedItem[];
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
    state.last = await readJson<LastRun>(`last:${state.league}`);
    state.history = (await readJson<Snapshot[]>(`history:${state.league}`)) ?? [];
    state.tabs = [];
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
      saved && state.leagues.includes(saved)
        ? saved
        : (state.leagues.find((l) => l !== 'Standard' && !l.startsWith('Hardcore')) ??
          state.leagues[0] ??
          '');
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
      const allItems: ValuedItem[] = [];
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
        allItems.push(...valued.items);
        if (i < selectedTabs.length - 1) await sleep(TAB_FETCH_GAP_MS);
      }

      const merged = new Map<string, ValuedItem>();
      for (const item of allItems) {
        const existing = merged.get(item.name);
        if (existing) {
          existing.count += item.count;
          existing.totalChaos += item.totalChaos;
        } else {
          merged.set(item.name, { ...item });
        }
      }
      const top = [...merged.values()]
        .sort((a, b) => b.totalChaos - a.totalChaos)
        .slice(0, TOP_ITEMS);
      const totalChaos = perTab.reduce((sum, t) => sum + t.chaos, 0);

      state.last = { ts: Date.now(), totalChaos, divineChaos: book.divineChaos, perTab, top };
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

      scroll.append(el('div', 'wl-section', 'Most valuable'));
      const items = el('div', 'wl-items');
      for (const item of state.last.top) {
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
        row.append(
          iconCell,
          el('span', 'wl-item-name', item.name),
          el('span', 'wl-item-count', item.count > 1 ? `×${item.count}` : ''),
          el('span', 'wl-item-val', `${formatChaos(item.totalChaos)} c`),
        );
        items.append(row);
      }
      if (state.last.top.length === 0) items.append(el('div', 'wl-empty', 'Nothing priceable found.'));
      scroll.append(items);
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
