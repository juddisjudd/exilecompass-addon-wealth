import { describe, expect, test } from 'bun:test';
import { valueItem, valueTab, formatChaos } from '../src/valuation';
import { appendSnapshot, HISTORY_CAP, sparklinePoints } from '../src/history';
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
