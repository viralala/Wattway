/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  scheduler.ts - charger-slot job scheduling (CS2305 Unit 3 · Lab 6).
 *
 *  A station has k ports (k identical "processors"). Every driver is a JOB
 *  with an arrival time, an expected charge time (burst) and a priority. The
 *  same input is run under three policies so the demo can put their average
 *  waits side by side:
 *
 *  fifo         NON-PREEMPTIVE, first come first served. Ready jobs wait in a
 *               LinkedQueue; whoever is charging finishes.
 *
 *  priority     PREEMPTIVE PRIORITY. Ready jobs wait in a MaxPriorityQueue. If
 *               a job arrives whose priority is strictly higher than the
 *               lowest-priority job currently charging (an ambulance, or a car
 *               at < 5 % battery), that session is paused and the urgent car
 *               takes the port; the paused car re-enters the ready queue with
 *               its remaining charge time.
 *
 *  round-robin  TIME-SLICED. Jobs sit on a CircularLinkedList; each round the
 *               turn pointer hands the k ports to the next k cars for one
 *               quantum. Newcomers are inserted just before the turn pointer,
 *               so they wait one full lap - nobody is starved.
 *
 *  Metrics (per job):  turnaround = finish - arrival
 *                      waiting    = turnaround - duration
 *
 *  Pure function: data in, timeline out. No database, no Express.
 *
 *  COMPLEXITY (n jobs, k ports, q quantum, D total charge time)
 *  ----------
 *      fifo ........ O(n * k)            - each event scans the k ports
 *      priority .... O(n * k + p log n)  - p = number of preemptions
 *      round-robin . O((D / q) * k + n)
 * ============================================================================
 */

import { LinkedQueue } from '../datastructures/Queue';
import { MaxPriorityQueue } from '../datastructures/PriorityQueue';
import { CircularLinkedList } from '../datastructures/LinkedList';

export const SCHEDULING_POLICIES = ['fifo', 'priority', 'round-robin'] as const;
export type SchedulingPolicy = (typeof SCHEDULING_POLICIES)[number];

export interface ChargeJob {
  id: string;
  label?: string;
  /** Minutes from the start of the simulation. */
  arrival: number;
  /** Expected charge time in minutes (> 0). */
  duration: number;
  /** Higher = more urgent. Only the priority policy reads it. */
  priority: number;
}

export interface TimelineSegment {
  jobId: string;
  port: number;
  start: number;
  end: number;
  /** How the segment ended. */
  outcome: 'completed' | 'preempted' | 'sliced';
}

export interface JobOutcome {
  id: string;
  label?: string;
  arrival: number;
  duration: number;
  priority: number;
  firstStart: number;
  finish: number;
  waiting: number;
  turnaround: number;
  /** Times this job was paused (preempted or sliced). */
  interruptions: number;
}

export interface ScheduleResult {
  policy: SchedulingPolicy;
  ports: number;
  quantum: number | null;
  timeline: TimelineSegment[];
  jobs: JobOutcome[];
  averageWait: number;
  averageTurnaround: number;
  maxWait: number;
  makespan: number;
  interruptions: number;
}

export interface ScheduleOptions {
  policy: SchedulingPolicy;
  ports: number;
  /** Round-robin slice length in minutes. Default 15. */
  quantum?: number;
}

const EPSILON = 1e-9;
const round2 = (value: number): number => Math.round(value * 100) / 100;

interface JobState {
  job: ChargeJob;
  remaining: number;
  firstStart: number | null;
  finish: number | null;
  interruptions: number;
}

interface Running {
  state: JobState;
  segmentStart: number;
}

function validate(jobs: readonly ChargeJob[], ports: number, quantum: number): void {
  if (!Number.isInteger(ports) || ports < 1) throw new RangeError('ports must be a positive integer');
  if (!(quantum > 0)) throw new RangeError('quantum must be positive');
  const ids = new Set<string>();
  for (const job of jobs) {
    if (!(job.duration > 0)) throw new RangeError(`Job ${job.id}: duration must be positive`);
    if (!(job.arrival >= 0)) throw new RangeError(`Job ${job.id}: arrival must be >= 0`);
    if (!Number.isFinite(job.priority)) throw new RangeError(`Job ${job.id}: priority must be finite`);
    if (ids.has(job.id)) throw new RangeError(`Duplicate job id ${job.id}`);
    ids.add(job.id);
  }
}

/** Arrival order, stable on the input order for simultaneous arrivals. */
function byArrival(jobs: readonly ChargeJob[]): JobState[] {
  return jobs
    .map((job, index) => ({ job, index }))
    .sort((a, b) => a.job.arrival - b.job.arrival || a.index - b.index)
    .map(({ job }) => ({ job, remaining: job.duration, firstStart: null, finish: null, interruptions: 0 }));
}

function summarise(
  policy: SchedulingPolicy,
  ports: number,
  quantum: number | null,
  states: JobState[],
  timeline: TimelineSegment[],
): ScheduleResult {
  const jobs: JobOutcome[] = states.map((s) => {
    const finish = s.finish as number;
    const turnaround = finish - s.job.arrival;
    return {
      id: s.job.id,
      ...(s.job.label !== undefined ? { label: s.job.label } : {}),
      arrival: s.job.arrival,
      duration: s.job.duration,
      priority: s.job.priority,
      firstStart: round2(s.firstStart as number),
      finish: round2(finish),
      waiting: round2(turnaround - s.job.duration),
      turnaround: round2(turnaround),
      interruptions: s.interruptions,
    };
  });
  const n = jobs.length;
  const sum = (pick: (j: JobOutcome) => number): number => jobs.reduce((acc, j) => acc + pick(j), 0);
  return {
    policy,
    ports,
    quantum,
    timeline: timeline.map((seg) => ({ ...seg, start: round2(seg.start), end: round2(seg.end) })),
    jobs,
    averageWait: n ? round2(sum((j) => j.waiting) / n) : 0,
    averageTurnaround: n ? round2(sum((j) => j.turnaround) / n) : 0,
    maxWait: n ? Math.max(...jobs.map((j) => j.waiting)) : 0,
    makespan: n ? Math.max(...jobs.map((j) => j.finish)) : 0,
    interruptions: states.reduce((acc, s) => acc + s.interruptions, 0),
  };
}

// ─── FIFO and preemptive priority (event-driven) ───────────────────────────

function eventDriven(jobs: readonly ChargeJob[], ports: number, preemptive: boolean): ScheduleResult {
  const states = byArrival(jobs);
  const timeline: TimelineSegment[] = [];
  const running: (Running | null)[] = new Array(ports).fill(null);
  const fifo = new LinkedQueue<JobState>();
  const urgent = new MaxPriorityQueue<JobState>();

  const readyEmpty = (): boolean => (preemptive ? urgent.isEmpty : fifo.isEmpty);
  const addReady = (s: JobState): void => {
    if (preemptive) urgent.enqueue(s, s.job.priority);
    else fifo.enqueue(s);
  };
  const takeReady = (): JobState => (preemptive ? urgent.dequeue() : fifo.dequeue()) as JobState;

  const start = (port: number, state: JobState, now: number): void => {
    if (state.firstStart === null) state.firstStart = now;
    running[port] = { state, segmentStart: now };
  };
  const stop = (port: number, now: number, outcome: TimelineSegment['outcome']): JobState => {
    const slot = running[port] as Running;
    timeline.push({ jobId: slot.state.job.id, port, start: slot.segmentStart, end: now, outcome });
    running[port] = null;
    return slot.state;
  };

  let now = states.length ? states[0].job.arrival : 0;
  let nextArrival = 0;
  let done = 0;

  while (done < states.length) {
    // 1. Admit everyone who has arrived by `now`.
    while (nextArrival < states.length && states[nextArrival].job.arrival <= now + EPSILON) {
      addReady(states[nextArrival]);
      nextArrival += 1;
    }

    // 2. Fill free ports, lowest port number first.
    for (let port = 0; port < ports && !readyEmpty(); port += 1) {
      if (running[port] === null) start(port, takeReady(), now);
    }

    // 3. Preempt: an urgent arrival bumps the least urgent car on a port.
    while (preemptive && !urgent.isEmpty) {
      let victim = -1;
      for (let port = 0; port < ports; port += 1) {
        const slot = running[port];
        if (slot === null) continue;
        const worse =
          victim === -1 ||
          slot.state.job.priority < (running[victim] as Running).state.job.priority ||
          (slot.state.job.priority === (running[victim] as Running).state.job.priority &&
            slot.segmentStart > (running[victim] as Running).segmentStart);
        if (worse) victim = port;
      }
      if (victim === -1 || (urgent.peekPriority() as number) <= (running[victim] as Running).state.job.priority) break;
      const paused = stop(victim, now, 'preempted');
      paused.interruptions += 1;
      start(victim, takeReady(), now);
      urgent.enqueue(paused, paused.job.priority);
    }

    // 4. Jump to the next event: an arrival or a completion.
    let nextCompletion = Infinity;
    for (const slot of running) if (slot) nextCompletion = Math.min(nextCompletion, now + slot.state.remaining);
    const arrivalAt = nextArrival < states.length ? states[nextArrival].job.arrival : Infinity;
    const next = Math.min(nextCompletion, arrivalAt);
    if (next === Infinity) break; // unreachable with valid input

    const elapsed = next - now;
    for (const slot of running) if (slot) slot.state.remaining -= elapsed;
    now = next;

    // 5. Retire everyone who just finished.
    for (let port = 0; port < ports; port += 1) {
      const slot = running[port];
      if (slot && slot.state.remaining <= EPSILON) {
        const finished = stop(port, now, 'completed');
        finished.remaining = 0;
        finished.finish = now;
        done += 1;
      }
    }
  }

  return summarise(preemptive ? 'priority' : 'fifo', ports, null, states, timeline);
}

// ─── Round robin (circular linked list) ─────────────────────────────────────

function roundRobin(jobs: readonly ChargeJob[], ports: number, quantum: number): ScheduleResult {
  const states = byArrival(jobs);
  const timeline: TimelineSegment[] = [];
  const ring = new CircularLinkedList<JobState>();

  let now = states.length ? states[0].job.arrival : 0;
  let nextArrival = 0;
  let done = 0;

  const admit = (): void => {
    while (nextArrival < states.length && states[nextArrival].job.arrival <= now + EPSILON) {
      ring.insertBeforeCurrent(states[nextArrival]);
      nextArrival += 1;
    }
  };

  while (done < states.length) {
    admit();
    if (ring.isEmpty) {
      now = states[nextArrival].job.arrival;
      continue;
    }

    // Hand the k ports to the next k cars around the ring.
    const turnCount = Math.min(ports, ring.size);
    const chosen: JobState[] = [];
    for (let i = 0; i < turnCount; i += 1) {
      chosen.push(ring.current() as JobState);
      ring.advance();
    }

    let roundLength = 0;
    chosen.forEach((state, port) => {
      const slice = Math.min(quantum, state.remaining);
      if (state.firstStart === null) state.firstStart = now;
      state.remaining -= slice;
      roundLength = Math.max(roundLength, slice);
      const finished = state.remaining <= EPSILON;
      timeline.push({ jobId: state.job.id, port, start: now, end: now + slice, outcome: finished ? 'completed' : 'sliced' });
      if (finished) {
        state.remaining = 0;
        state.finish = now + slice;
        done += 1;
        ring.remove((candidate) => candidate === state);
      } else {
        state.interruptions += 1;
      }
    });

    now += roundLength;
  }

  return summarise('round-robin', ports, quantum, states, timeline);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function simulateSchedule(jobs: readonly ChargeJob[], options: ScheduleOptions): ScheduleResult {
  const quantum = options.quantum ?? 15;
  validate(jobs, options.ports, quantum);
  switch (options.policy) {
    case 'fifo':
      return eventDriven(jobs, options.ports, false);
    case 'priority':
      return eventDriven(jobs, options.ports, true);
    case 'round-robin':
      return roundRobin(jobs, options.ports, quantum);
    default:
      throw new RangeError(`Unknown policy ${String(options.policy)}`);
  }
}

export interface ScheduleComparison {
  results: Record<SchedulingPolicy, ScheduleResult>;
  /** Policy with the lowest average wait (ties: listed order). */
  lowestAverageWait: SchedulingPolicy;
  /** Average wait of the urgent jobs (priority above `urgentThreshold`) under each policy. */
  urgentAverageWait: Record<SchedulingPolicy, number | null>;
}

/** Run every policy on the same input - the headline demo. */
export function compareSchedules(
  jobs: readonly ChargeJob[],
  ports: number,
  quantum = 15,
  urgentThreshold = 50,
): ScheduleComparison {
  const results = {} as Record<SchedulingPolicy, ScheduleResult>;
  const urgentAverageWait = {} as Record<SchedulingPolicy, number | null>;
  let best: SchedulingPolicy = SCHEDULING_POLICIES[0];

  for (const policy of SCHEDULING_POLICIES) {
    const result = simulateSchedule(jobs, { policy, ports, quantum });
    results[policy] = result;
    const urgent = result.jobs.filter((j) => j.priority >= urgentThreshold);
    urgentAverageWait[policy] = urgent.length
      ? round2(urgent.reduce((acc, j) => acc + j.waiting, 0) / urgent.length)
      : null;
    if (result.averageWait < results[best].averageWait) best = policy;
  }
  return { results, lowestAverageWait: best, urgentAverageWait };
}

/**
 * A fixed, readable input for the demo when a station's live line is empty:
 * eight cars on a two-port station, two of them urgent.
 */
export const DEMO_JOBS: readonly ChargeJob[] = Object.freeze([
  { id: 'car-1', label: 'Nexon EV · 40%', arrival: 0, duration: 40, priority: 18 },
  { id: 'car-2', label: 'MG ZS EV · 55%', arrival: 2, duration: 30, priority: 14 },
  { id: 'car-3', label: 'Tiago EV · 30%', arrival: 5, duration: 45, priority: 21 },
  { id: 'car-4', label: 'Ambulance', arrival: 8, duration: 20, priority: 100 },
  { id: 'car-5', label: 'Kona · 60%', arrival: 10, duration: 25, priority: 12 },
  { id: 'car-6', label: 'XUV400 · 3%', arrival: 12, duration: 35, priority: 79 },
  { id: 'car-7', label: 'Comet · 50%', arrival: 20, duration: 15, priority: 15 },
  { id: 'car-8', label: 'Punch EV · 45%', arrival: 25, duration: 30, priority: 16 },
]);
