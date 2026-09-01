// Snapshot history per league, kept small enough for add-on storage (which is
// the app's shared settings file — hence the cap).
export interface Snapshot {
  /** Unix ms. */
  ts: number;
  totalChaos: number;
  divineChaos: number;
}

export const HISTORY_CAP = 300;

export function appendSnapshot(history: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const next = [...history, snapshot];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/** Points for an inline SVG polyline, scaled into width × height. */
export function sparklinePoints(history: Snapshot[], width: number, height: number): string {
  if (history.length < 2) return '';
  const values = history.map((s) => s.totalChaos);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (history.length - 1);
  return history
    .map((s, i) => {
      const x = i * step;
      const y = height - ((s.totalChaos - min) / span) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
