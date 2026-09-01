# Wealth

ExileCompass add-on: a stash wealth tracker for Path of Exile 1, in the spirit
of Sidekick's Wealth Tracker.

Pick the stash tabs to track, take a snapshot, and the panel values every
priceable item against live poe.ninja prices: total in chaos (and divines),
per-tab totals, your most valuable items, and a history sparkline across
snapshots. Rares, gems and maps are deliberately not counted — poe.ninja can't
price them by name, and guessing would be worse than omitting.

**PoE1 only for now**: GGG's account stash API does not cover Path of Exile 2
yet. When it does, this add-on grows a game switch.

## Requirements

- ExileCompass **1.5.5+**, signed in to your exilecompass.com account
  (Settings → Account) with a **Path of Exile account connected**
  (exilecompass.com/settings). The panel walks you through both if missing.

## Permissions

- `poe.stashes` — the host reads your stash tabs and league list from
  api.pathofexile.com with your account token. The token itself never enters
  the add-on sandbox; the host performs every call and enforces GGG's rate
  limits (the panel also spaces its requests and honors `Retry-After`).
- `network.fetch:poe.ninja` — price tables
- `network.fetch:web.poecdn.com` — item icons (disk-cached by the host)
- `storage.read` / `storage.write` — tab selection, last run, and snapshot
  history per league
- `shell.open:exilecompass.com` — the "connect your account" link

## Develop

1. `npm install`
2. `npm run check` — type-check
3. `npm run test` — valuation/history unit tests (needs bun)
4. `npm run build` — bundle to `dist/panel.js`

## Publish

1. Bump the version in `plugin.manifest.json` and `package.json` (must match).
2. Tag `vX.Y.Z` and push — the workflow builds and releases
   `exilecompass-addon.zip`.
3. Add/update the entry in the ExileCompass registry (`registry.v1.json`).

## Credits

- Concept modeled on [Sidekick](https://github.com/Sidekick-Poe/Sidekick)'s
  Wealth Tracker
- Prices by [poe.ninja](https://poe.ninja)
