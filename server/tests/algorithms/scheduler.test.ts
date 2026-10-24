/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * scheduler.test.ts — charger-slot job scheduling (Lab 6). Hand-worked cases,
 * a brute-force check for FIFO, and structural invariants for every policy.
 * ---------------------------------------------------------------------------
 */

import {
  DEMO_JOBS,
  SCHEDULING_POLICIES,
  compareSchedules,
  simulateSchedule,
  type ChargeJob,
  type ScheduleResult,
} from '../../src/algorithms/scheduler';

const job = (id: string, arrival: number, duration: number, priority = 10): ChargeJob => ({
  id,
  arrival,
  duration,
  priority,
});

function randomJobs(count: number, seed: number): ChargeJob[] {
  let state = seed;
  const next = (max: number): number => {
    state = (state * 48271) % 2147483647;
    return state % max;
  };
  return Array.from({ length: count }, (_, i) => job(`j${i}`, next(60), 5 + next(40), next(100)));
}

/** Non-preemptive FIFO with k servers, the textbook way: earliest-free port. */
function bruteForceFifoWaits(jobs: ChargeJob[], ports: number): Record<string, number> {
  const free = new Array(ports).fill(0);
  const ordered = jobs.map((j, i) => ({ j, i })).sort((a, b) => a.j.arrival - b.j.arrival || a.i - b.i);
  const waits: Record<string, number> = {};
  for (const { j } of ordered) {
    let best = 0;
    for (let p = 1; p < ports; p += 1) if (free[p] < free[best]) best = p;
    const start = Math.max(j.arrival, free[best]);
    waits[j.id] = start - j.arrival;
    free[best] = start + j.duration;
  }
  return waits;
}

function assertInvariants(result: ScheduleResult, jobs: ChargeJob[]): void {
  // Each job charged for exactly its duration.
  for (const j of jobs) {
    const served = result.timeline
      .filter((s) => s.jobId === j.id)
      .reduce((acc, s) => acc + (s.end - s.start), 0);
    expect(served).toBeCloseTo(j.duration, 1);
    const outcome = result.jobs.find((o) => o.id === j.id);
    expect(outcome?.finish).toBeGreaterThanOrEqual(j.arrival + j.duration - 0.01);
    expect(outcome?.firstStart).toBeGreaterThanOrEqual(j.arrival - 0.01);
    expect(outcome?.waiting).toBeGreaterThanOrEqual(-0.01);
  }
  // No port ever charges two cars at once.
  for (let port = 0; port < result.ports; port += 1) {
    const segments = result.timeline.filter((s) => s.port === port).sort((a, b) => a.start - b.start);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i].start).toBeGreaterThanOrEqual(segments[i - 1].end - 0.01);
    }
  }
  // A car is never on two ports at once.
  for (const j of jobs) {
    const segments = result.timeline.filter((s) => s.jobId === j.id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i].start).toBeGreaterThanOrEqual(segments[i - 1].end - 0.01);
    }
  }
}

describe('scheduler — FIFO (non-preemptive)', () => {
  it('solves the classic single-port FCFS example', () => {
    const result = simulateSchedule([job('A', 0, 5), job('B', 1, 3), job('C', 2, 8)], { policy: 'fifo', ports: 1 });
    expect(result.jobs.map((j) => [j.id, j.firstStart, j.finish, j.waiting])).toEqual([
      ['A', 0, 5, 0],
      ['B', 5, 8, 4],
      ['C', 8, 16, 6],
    ]);
    expect(result.averageWait).toBeCloseTo(3.33, 2);
    expect(result.interruptions).toBe(0);
  });

  it('agrees with a brute-force earliest-free-port simulation (property test)', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const jobs = randomJobs(12, seed);
      const ports = 1 + (seed % 4);
      const result = simulateSchedule(jobs, { policy: 'fifo', ports });
      const expected = bruteForceFifoWaits(jobs, ports);
      for (const outcome of result.jobs) expect(outcome.waiting).toBeCloseTo(expected[outcome.id], 2);
      assertInvariants(result, jobs);
    }
  });

  it('leaves ports idle between arrivals rather than inventing work', () => {
    const result = simulateSchedule([job('A', 0, 5), job('B', 50, 5)], { policy: 'fifo', ports: 2 });
    expect(result.jobs.map((j) => j.waiting)).toEqual([0, 0]);
    expect(result.makespan).toBe(55);
  });
});

describe('scheduler — preemptive priority', () => {
  it('pauses a low-priority session for an urgent arrival (hand-worked)', () => {
    const result = simulateSchedule(
      [job('A', 0, 10, 1), job('B', 2, 4, 5), job('C', 4, 2, 3)],
      { policy: 'priority', ports: 1 },
    );
    const byId = Object.fromEntries(result.jobs.map((j) => [j.id, j]));
    expect(byId.A.finish).toBe(16);
    expect(byId.B.finish).toBe(6);
    expect(byId.C.finish).toBe(8);
    expect([byId.A.waiting, byId.B.waiting, byId.C.waiting]).toEqual([6, 0, 2]);
    expect(byId.A.interruptions).toBe(1);
    expect(result.timeline.filter((s) => s.outcome === 'preempted')).toEqual([
      { jobId: 'A', port: 0, start: 0, end: 2, outcome: 'preempted' },
    ]);
  });

  it('does not preempt for an equal priority', () => {
    const result = simulateSchedule([job('A', 0, 10, 5), job('B', 1, 1, 5)], { policy: 'priority', ports: 1 });
    expect(result.interruptions).toBe(0);
    expect(result.jobs[1].firstStart).toBe(10);
  });

  it('bumps the least urgent of several busy ports', () => {
    const result = simulateSchedule(
      [job('low', 0, 30, 1), job('mid', 0, 30, 20), job('ambulance', 5, 10, 100)],
      { policy: 'priority', ports: 2 },
    );
    const low = result.jobs.find((j) => j.id === 'low');
    const mid = result.jobs.find((j) => j.id === 'mid');
    expect(low?.interruptions).toBe(1);
    expect(mid?.interruptions).toBe(0);
    expect(result.jobs.find((j) => j.id === 'ambulance')?.waiting).toBe(0);
  });

  it('keeps the invariants on random input', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const jobs = randomJobs(10, seed * 7);
      assertInvariants(simulateSchedule(jobs, { policy: 'priority', ports: 1 + (seed % 3) }), jobs);
    }
  });
});

describe('scheduler — round robin', () => {
  it('time-slices one port between two cars (hand-worked)', () => {
    const result = simulateSchedule([job('A', 0, 5), job('B', 0, 3)], { policy: 'round-robin', ports: 1, quantum: 2 });
    expect(result.timeline.map((s) => `${s.jobId}:${s.start}-${s.end}`)).toEqual([
      'A:0-2',
      'B:2-4',
      'A:4-6',
      'B:6-7',
      'A:7-8',
    ]);
    expect(result.jobs.map((j) => j.finish)).toEqual([8, 7]);
    expect(result.quantum).toBe(2);
  });

  it('keeps the invariants on random input', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const jobs = randomJobs(10, seed * 13);
      assertInvariants(simulateSchedule(jobs, { policy: 'round-robin', ports: 1 + (seed % 3), quantum: 1 + (seed % 20) }), jobs);
    }
  });
});

describe('scheduler — comparison and validation', () => {
  it('runs all three policies on the same demo input; urgent cars wait less under priority', () => {
    const comparison = compareSchedules(DEMO_JOBS, 2, 15);
    expect(Object.keys(comparison.results).sort()).toEqual([...SCHEDULING_POLICIES].sort());
    for (const policy of SCHEDULING_POLICIES) assertInvariants(comparison.results[policy], [...DEMO_JOBS]);
    expect(comparison.urgentAverageWait.priority as number).toBeLessThan(comparison.urgentAverageWait.fifo as number);
    expect(SCHEDULING_POLICIES).toContain(comparison.lowestAverageWait);
  });

  it('handles an empty job list', () => {
    const result = simulateSchedule([], { policy: 'fifo', ports: 2 });
    expect(result.jobs).toEqual([]);
    expect(result.averageWait).toBe(0);
  });

  it('rejects bad input', () => {
    expect(() => simulateSchedule([job('A', 0, 5)], { policy: 'fifo', ports: 0 })).toThrow(RangeError);
    expect(() => simulateSchedule([job('A', 0, 0)], { policy: 'fifo', ports: 1 })).toThrow(RangeError);
    expect(() => simulateSchedule([job('A', -1, 5)], { policy: 'fifo', ports: 1 })).toThrow(RangeError);
    expect(() => simulateSchedule([job('A', 0, 5), job('A', 1, 5)], { policy: 'fifo', ports: 1 })).toThrow(/Duplicate/);
    expect(() => simulateSchedule([job('A', 0, 5)], { policy: 'round-robin', ports: 1, quantum: 0 })).toThrow(RangeError);
  });
});
