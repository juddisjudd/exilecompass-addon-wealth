import { describe, expect, test } from 'bun:test';
import { compareItems, valueItem, valueTab, formatChaos, type ValuedItem } from '../src/valuation';
import { appendSnapshot, HISTORY_CAP, sparklinePoints } from '../src/history';
import { defaultLeague } from '../src/poe';
import type { PriceBook } from '../src/pricing';

const book: PriceBook = {
  league: 'Test',
  exchange: new Map([
    ['divine orb', 200],
    ['chaos orb', 1],
    ['the doctor', 900],
    ['golden oil', 378],
  ]),
  uniques: new Map([
    ['headhunter', 5000],
    ['mageblood', 12000],
  ]),
  meta: new Map([
    ['divine orb', { change: 3.2, category: 'Currency' }],
    ['headhunter', { change: -8.1, category: 'Uniques' }],
  ]),
  divineChaos: 200,
};

describe('valueItem', () => {
  test('stackable currency matches by typeLine at stack size', () => {
    const v = valueItem({ typeLine: 'Divine Orb', stackSize: 3, frameType: 5 }, book);
    expect(v?.totalChaos).toBe(600);
    expect(v?.count).toBe(3);
  });

  test('divination cards match by typeLine', () => {
    const v = valueItem({ typeLine: 'The Doctor', stackSize: 2, frameType: 6 }, book);
    expect(v?.totalChaos).toBe(1800);
  });

  test('uniques match by name, not typeLine', () => {
    const v = valueItem(
      { name: 'Headhunter', typeLine: 'Leather Belt', frameType: 3 },
      book,
    );
    expect(v?.unitChaos).toBe(5000);
    expect(v?.name).toBe('Headhunter');
  });

  test('foil uniques (frameType 9) still price by name', () => {
    expect(valueItem({ name: 'Mageblood', typeLine: 'Heavy Belt', frameType: 9 }, book)?.unitChaos).toBe(12000);
  });

  test('unpriceable items return null', () => {
    expect(valueItem({ name: 'Random Rare', typeLine: 'Vaal Regalia', frameType: 2 }, book)).toBeNull();
    expect(valueItem({}, book)).toBeNull();
  });

  test('carries poe.ninja change and category when known', () => {
    const divine = valueItem({ typeLine: 'Divine Orb', stackSize: 1, frameType: 5 }, book);
    expect(divine?.change).toBe(3.2);
    expect(divine?.category).toBe('Currency');
    const hh = valueItem({ name: 'Headhunter', typeLine: 'Leather Belt', frameType: 3 }, book);
    expect(hh?.change).toBe(-8.1);
    expect(hh?.category).toBe('Uniques');
    expect(valueItem({ typeLine: 'Golden Oil', stackSize: 1, frameType: 5 }, book)?.change).toBeUndefined();
  });
});

describe('compareItems', () => {
  const items: ValuedItem[] = [
    { name: 'B', count: 5, unitChaos: 1, totalChaos: 5, change: -2 },
    { name: 'A', count: 1, unitChaos: 100, totalChaos: 100, change: 10 },
    { name: 'C', count: 3, unitChaos: 10, totalChaos: 30 },
  ];

  test('sorts by total descending by default direction', () => {
    expect([...items].sort(compareItems('total', -1)).map((i) => i.name)).toEqual(['A', 'C', 'B']);
  });

  test('name ascending', () => {
    expect([...items].sort(compareItems('name', 1)).map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });

  test('unknown 7d change sorts last in both directions', () => {
    expect([...items].sort(compareItems('change', -1)).map((i) => i.name)).toEqual(['A', 'B', 'C']);
    expect([...items].sort(compareItems('change', 1)).map((i) => i.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('defaultLeague', () => {
  test('skips permanent leagues and their variants', () => {
    expect(
      defaultLeague([
        'Standard',
        'Hardcore',
        'Solo Self-Found',
        'Hardcore SSF',
        'Ruthless',
        'Hardcore Ruthless',
        'SSF Ruthless',
        'Hardcore SSF Ruthless',
        'Allflame',
        'Hardcore Allflame',
      ]),
    ).toBe('Allflame');
  });

  test('falls back to the first entry when nothing qualifies', () => {
    expect(defaultLeague(['Standard', 'Hardcore'])).toBe('Standard');
    expect(defaultLeague([])).toBe('');
  });
});

describe('valueTab', () => {
  test('merges duplicate names and sorts by total', () => {
    const result = valueTab(
      [
        { typeLine: 'Divine Orb', stackSize: 2, frameType: 5 },
        { typeLine: 'Divine Orb', stackSize: 5, frameType: 5 },
        { typeLine: 'Golden Oil', stackSize: 1, frameType: 5 },
        { name: 'Headhunter', typeLine: 'Leather Belt', frameType: 3 },
      ],
      book,
    );
    expect(result.totalChaos).toBe(2 * 200 + 5 * 200 + 378 + 5000);
    expect(result.items[0].name).toBe('Headhunter');
    expect(result.items.find((i) => i.name === 'Divine Orb')?.count).toBe(7);
  });
});

describe('history', () => {
  test('appendSnapshot caps length', () => {
    let history = Array.from({ length: HISTORY_CAP }, (_, i) => ({
      ts: i,
      totalChaos: i,
      divineChaos: 200,
    }));
    history = appendSnapshot(history, { ts: 9999, totalChaos: 1, divineChaos: 200 });
    expect(history).toHaveLength(HISTORY_CAP);
    expect(history[history.length - 1].ts).toBe(9999);
  });

  test('sparkline needs two points and stays in bounds', () => {
    expect(sparklinePoints([{ ts: 1, totalChaos: 5, divineChaos: 0 }], 100, 20)).toBe('');
    const points = sparklinePoints(
      [
        { ts: 1, totalChaos: 0, divineChaos: 0 },
        { ts: 2, totalChaos: 50, divineChaos: 0 },
        { ts: 3, totalChaos: 100, divineChaos: 0 },
      ],
      100,
      20,
    );
    const ys = points.split(' ').map((p) => Number(p.split(',')[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(20);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
});

describe('formatChaos', () => {
  test('rounds by magnitude', () => {
    expect(formatChaos(12345)).toBe('12,345');
    expect(formatChaos(12.34)).toBe('12.3');
    expect(formatChaos(0.53)).toBe('0.53');
  });
});
