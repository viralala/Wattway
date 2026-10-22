/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * queueAnalytics.test.ts — urgency, wait estimates, the operator report and
 * the leftist-heap line merge. Pure functions, no database.
 * ---------------------------------------------------------------------------
 */

import {
  buildOperatorReport,
  estimateWaits,
  isUrgent,
  mergeWaitingLines,
  urgencyScore,
  type WaitingDriver,
} from '../../src/algorithms/queueAnalytics';

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const minutesAgo = (m: number): number => NOW - m * 60_000;

const driver = (id: string, overrides: Partial<WaitingDriver> = {}): WaitingDriver => ({
  id,
  userId: `user-${id}`,
  joinedAt: NOW,
  batteryPct: 50,
  emergency: false,
  expectedChargeMinutes: 30,
  ...overrides,
});

describe('urgency', () => {
  it('flags emergency vehicles and batteries under 5 %', () => {
    expect(isUrgent(driver('a', { emergency: true }))).toBe(true);
    expect(isUrgent(driver('b', { batteryPct: 4 }))).toBe(true);
    expect(isUrgent(driver('c', { batteryPct: 5 }))).toBe(false);
    expect(isUrgent(driver('d', { batteryPct: null }))).toBe(false);
  });

  it('orders ambulance > critical battery > low battery > full battery', () => {
    const ambulance = urgencyScore(driver('a', { emergency: true, batteryPct: 80 }), NOW);
    const critical = urgencyScore(driver('b', { batteryPct: 3 }), NOW);
    const low = urgencyScore(driver('c', { batteryPct: 20 }), NOW);
    const full = urgencyScore(driver('d', { batteryPct: 95 }), NOW);
    expect(ambulance).toBeGreaterThan(critical);
    expect(critical).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(full);
  });

  it('grows with time waited, but only up to a cap', () => {
    const fresh = urgencyScore(driver('a', { joinedAt: NOW }), NOW);
    const waited = urgencyScore(driver('a', { joinedAt: minutesAgo(20) }), NOW);
    const ages = urgencyScore(driver('a', { joinedAt: minutesAgo(500) }), NOW);
    expect(waited - fresh).toBeCloseTo(10, 1);
    expect(ages - fresh).toBeCloseTo(30, 1);
  });
});

describe('estimateWaits — k-server min-heap', () => {
  it('gives the first k drivers the free ports, then queues behind them', () => {
    expect(estimateWaits([0, 0], [30, 30, 30, 30, 30])).toEqual([0, 0, 30, 30, 60]);
  });

  it('respects ports that are busy for a while', () => {
    expect(estimateWaits([10, 25], [20, 20, 20])).toEqual([10, 25, 30]);
  });

  it('handles an empty line and a station with no usable port', () => {
    expect(estimateWaits([0], [])).toEqual([]);
    expect(estimateWaits([], [30])).toEqual([Infinity]);
  });
});

describe('buildOperatorReport', () => {
  const line = [
    driver('a', { joinedAt: minutesAgo(5), batteryPct: 60 }),
    driver('b', { joinedAt: minutesAgo(40), batteryPct: 70 }),
    driver('c', { joinedAt: minutesAgo(12), emergency: true }),
    driver('d', { joinedAt: minutesAgo(25), batteryPct: 2 }),
  ];

  it('heapsorts by wait time, longest first, and records the passes', () => {
    const report = buildOperatorReport(line, NOW);
    expect(report.sortedByWait.map((d) => d.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(report.heapsort.passes).toBe(4); // build + (n - 1) extractions
    expect(report.heapsort.trace?.at(-1)).toEqual([40, 25, 12, 5]);
  });

  it('reads both ends of the urgency DEPQ and the top of the max-heap', () => {
    const report = buildOperatorReport(line, NOW, 2);
    expect(report.depq.mostUrgent?.id).toBe('c');
    expect(report.depq.leastUrgent?.id).toBe('a');
    expect(report.urgentQueue.map((d) => d.id)).toEqual(['c', 'd']);
  });

  it('copes with an empty line', () => {
    const report = buildOperatorReport([], NOW);
    expect(report.waiting).toBe(0);
    expect(report.sortedByWait).toEqual([]);
    expect(report.depq).toEqual({ mostUrgent: null, leastUrgent: null });
  });
});

describe('mergeWaitingLines — leftist heap', () => {
  it('interleaves two lines by seniority, urgent drivers first', () => {
    const target = [driver('t1', { joinedAt: minutesAgo(30) }), driver('t2', { joinedAt: minutesAgo(10) })];
    const incoming = [
      driver('s1', { joinedAt: minutesAgo(20) }),
      driver('s2', { joinedAt: minutesAgo(1), emergency: true }),
      driver('s3', { joinedAt: minutesAgo(5) }),
    ];
    const { merged, stats } = mergeWaitingLines(target, incoming);
    expect(merged.map((d) => d.id)).toEqual(['s2', 't1', 's1', 't2', 's3']);
    expect(stats.targetSize).toBe(2);
    expect(stats.incomingSize).toBe(3);
    expect(stats.rightSpineMerged).toBeLessThanOrEqual(Math.floor(Math.log2(6)));
  });

  it('agrees with concatenate-and-sort on random lines (property test)', () => {
    let seed = 17;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let round = 0; round < 25; round += 1) {
      const make = (prefix: string, n: number): WaitingDriver[] =>
        Array.from({ length: n }, (_, i) =>
          driver(`${prefix}${i}`, { joinedAt: minutesAgo(Math.floor(random() * 120)), emergency: random() < 0.1 }),
        );
      const a = make('a', Math.floor(random() * 30));
      const b = make('b', Math.floor(random() * 30));
      const expected = [...a, ...b]
        .sort((x, y) => Number(y.emergency) - Number(x.emergency) || x.joinedAt - y.joinedAt || (x.id < y.id ? -1 : 1))
        .map((d) => d.id);
      expect(mergeWaitingLines(a, b).merged.map((d) => d.id)).toEqual(expected);
    }
  });
});
