// The contract the ExileCompass host provides to an addon panel.
// The host runs your bundled panel inside a sandboxed iframe and calls the
// default-exported `mount(ctx)` once the panel is shown.

export type AddonGame = 'poe1' | 'poe2';

export interface AddonFetchResponse {
  status: number;
  body: string;
}

export interface AddonRequestOptions {
  url: string;
  /** `GET` (default) or `POST` — nothing else is permitted. */
  method?: 'GET' | 'POST';
  /** Only `Accept` and `Content-Type` may be set. The host owns the rest. */
  headers?: Record<string, string>;
  /** Up to 64 KB. */
  body?: string;
}

export interface AddonRequestResponse {
  status: number;
  /**
   * The subset the host lets through: `x-rate-limit-*`, `retry-after`, and
   * `content-type`. Names are lowercase.
   */
  headers: Record<string, string>;
  body: string;
}

export interface PoeApiResponse {
  status: number;
  /** Raw JSON from api.pathofexile.com. */
  body: string;
  /**
   * Set on HTTP 429 — wait this many seconds before any further poe.* call.
   * GGG's rate limits must be respected; ignoring them can get the player's
   * API access restricted.
   */
  retry_after?: number | null;
}

export interface PoeStatus {
  /** The app is signed in to an exilecompass.com account. */
  appLinked: boolean;
  /** That account has a Path of Exile account connected. */
  poeLinked: boolean;
  /** The PoE connection lapsed — reconnect at exilecompass.com/settings. */
  poeExpired: boolean;
  poeName: string | null;
}

export interface AddonHost {
  /**
   * Per-addon key/value storage, persisted by the host and namespaced to this
   * addon. Requires the `storage.read` / `storage.write` permissions.
   */
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  /**
   * HTTPS GET performed by the host (the sandboxed iframe has an opaque
   * origin, so APIs without CORS headers are unreachable from it). The URL
   * hostname must be covered by a `network.fetch:<host>` permission.
   * Absent on ExileCompass versions before 1.4.0.
   */
  net?: {
    fetch(url: string): Promise<AddonFetchResponse>;
    /**
     * Image fetch cached on disk by the host for about a week, returned as a
     * `data:` URL — use it for <img> sources, since the sandboxed panel
     * can't use the browser's HTTP cache. Absent before ExileCompass 1.4.1.
     */
    fetchImage?(url: string): Promise<string>;
    /**
     * GET cached on disk by the host for up to `maxAgeSeconds` (one day by
     * default, 30 days at most). Use it for large, slow-moving payloads —
     * game data that changes per patch, not per session. Plain `fetch`
     * re-downloads every call, and addon storage is the wrong place to park a
     * megabyte: it shares one file with the app's own settings.
     * Absent before ExileCompass 1.5.0.
     */
    fetchCached?(url: string, maxAgeSeconds?: number): Promise<AddonFetchResponse>;
    /**
     * GET or POST performed by the host, returning the allowlisted response
     * headers as well as the body. Needs `network.request:<host>`, which is
     * a stronger grant than `network.fetch:<host>` and implies it.
     *
     * Use this instead of `fetch` when an API rejects GET, or when its
     * rate-limit headers have to be obeyed. Absent before ExileCompass 1.5.0.
     */
    request?(opts: AddonRequestOptions): Promise<AddonRequestResponse>;
  };
  /**
   * Open a URL in the player's default browser. The hostname must be covered
   * by a `shell.open:<host>` permission, and only https:// is accepted.
   * Absent on ExileCompass versions before 1.5.0.
   */
  shell?: {
    openExternal(url: string): Promise<void>;
  };
  /**
   * Which game the overlay targets (the footer PoE1/PoE2 switch). Requires
   * `game.read`. Absent on ExileCompass versions before 1.4.0.
   */
  game?: {
    get(): Promise<AddonGame>;
    onChange(cb: (game: AddonGame) => void): () => void;
  };
  /**
   * Read-only access to the player's Path of Exile account, performed by the
   * host with the token from the user's linked exilecompass.com account
   * (Settings → Account). The whole namespace requires the `poe.stashes`
   * permission — the strongest grant an add-on can request; ask for it only
   * when account data is the point of the add-on. Stash and league endpoints
   * cover PoE1 only until GGG opens the equivalent PoE2 APIs. Absent on
   * ExileCompass versions before 1.5.5.
   */
  poe?: {
    status(): Promise<PoeStatus>;
    /** GET /account/leagues — the account's leagues, raw JSON in `body`. */
    leagues(): Promise<PoeApiResponse>;
    /** GET /stash/<league> — stash tab metadata; folders carry children. */
    stashList(league: string): Promise<PoeApiResponse>;
    /** GET /stash/<league>[/<parent>]/<id> — one tab with its items. */
    stashTab(league: string, stashId: string, parentId?: string | null): Promise<PoeApiResponse>;
  };
}

export interface PanelContext {
  /** The root element to render your panel UI into. */
  root: HTMLElement;
  /** The host API bridge (postMessage under the hood). */
  host: AddonHost;
}

export type MountFn = (ctx: PanelContext) => void | Promise<void>;
