import { describe, expect, it } from 'vitest';
import { farthestFrom, formatMs, logTicks, nearestNode, offsetPolyline, percentOver, pickStops, revealedCount } from './lab';
import type { LabNode } from '../services/algorithms';

const grid: LabNode[] = [];
for (let i = 0; i < 25; i += 1) grid.push({ id: `n${i}`, x: (i % 5) * 6, y: Math.floor(i / 5) * 6, elevation: 0 });

describe('pickStops', () => {
  it('returns the requested count, distinct, starting at the start node', () => {
    const stops = pickStops(grid, 8, 'n12');
    expect(stops).toHaveLength(8);
    expect(stops[0]).toBe('n12');
    expect(new Set(stops).size).toBe(8);
  });

  it('is deterministic and spreads out (second stop is a far corner)', () => {
    expect(pickStops(grid, 5, 'n0')).toEqual(pickStops(grid, 5, 'n0'));
    expect(pickStops(grid, 2, 'n0')[1]).toBe('n24');
  });

  it('never returns more stops than nodes, and tolerates an unknown start', () => {
    expect(pickStops(grid.slice(0, 4), 12, 'n0')).toHaveLength(4);
    expect(pickStops(grid, 3, 'nope')[0]).toBe('n0');
    expect(pickStops([], 3, 'n0')).toEqual([]);
  });
});

describe('map helpers', () => {
  it('finds the farthest node', () => expect(farthestFrom(grid, 'n0')).toBe('n24'));
  it('snaps a click to the nearest node, or nothing if too far', () => {
    expect(nearestNode(grid, 6.4, 5.8)?.id).toBe('n6');
    expect(nearestNode(grid, 3, 3, 1)).toBeNull();
  });
});

describe('offsetPolyline', () => {
  it('shifts a horizontal line sideways by the offset and leaves it parallel', () => {
    const out = offsetPolyline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }], 0.5);
    expect(out.map((p) => p.y)).toEqual([0.5, 0.5, 0.5]);
    expect(out.map((p) => p.x)).toEqual([0, 4, 8]);
  });
  it('is a no-op for zero offset or a single point', () => {
    const one = [{ x: 1, y: 1 }];
    expect(offsetPolyline(one, 1)).toBe(one);
    expect(offsetPolyline([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
});

describe('formatting & scales', () => {
  it('formats runtimes across magnitudes', () => {
    expect(formatMs(0.001)).toBe('<0.01 ms');
    expect(formatMs(1.234)).toBe('1.23 ms');
    expect(formatMs(45.67)).toBe('45.7 ms');
    expect(formatMs(2500)).toBe('2.50 s');
  });

  it('builds decade ticks that cover the range', () => {
    expect(logTicks(0.02, 30)).toEqual([0.01, 0.1, 1, 10, 100]);
    expect(logTicks(1, 1).length).toBeGreaterThanOrEqual(1);
  });

  it('computes percent over the best cost', () => {
    expect(percentOver(110, 100)).toBeCloseTo(10);
    expect(percentOver(100, 100)).toBe(0);
    expect(percentOver(null, 100)).toBe(0);
  });

  it('clamps the animation reveal count', () => {
    expect(revealedCount(10, 3.9)).toBe(3);
    expect(revealedCount(10, 99)).toBe(10);
    expect(revealedCount(10, -5)).toBe(0);
    expect(revealedCount(10, Infinity)).toBe(10);
  });
});
