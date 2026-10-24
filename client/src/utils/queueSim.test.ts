import { describe, expect, it } from 'vitest';
import { STATIONS, type Station } from '../services/stations';
import {
  checkIn,
  clockLabel,
  estimateWait,
  HOLD_MIN,
  initSim,
  join,
  leave,
  tick,
  yourPosition,
  type SimPort,
  type SimState,
} from './queueSim';
import { SESSION_MIN } from './stations';

const station = (id: string) => STATIONS.find((s) => s.id === id) as Station;
const run = (s: SimState, n: number) => Array.from({ length: n }).reduce<SimState>((acc) => tick(acc), s);
/** Tick until `done(state)` or give up. */
function until(s: SimState, done: (s: SimState) => boolean, max = 2000): SimState {
  let cur = s;
  for (let i = 0; i < max && !done(cur); i += 1) cur = tick(cur);
  return cur;
}

describe('initSim', () => {
  it('mirrors the station: same ports, queue length and statuses', () => {
    const st = station('st-02');
    const s = initSim(st);
    expect(s.line).toHaveLength(st.queueLength);
    expect(s.ports.map((p) => p.status)).toEqual(st.ports.map((p) => p.status));
    expect(s.ports.filter((p) => p.status === 'occupied').every((p) => p.driver && p.minsLeft > 0)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(run(initSim(station('st-03'), 7), 120)).toEqual(run(initSim(station('st-03'), 7), 120));
  });
});

describe('the line is FIFO', () => {
  it('the driver at the head is the next one to get a port', () => {
    let s = initSim(station('st-02'), 1);
    const head = s.line[0].id;
    s = until(s, (x) => x.ports.some((p) => p.driver?.id === head));
    expect(s.line.some((d) => d.id === head)).toBe(false);
  });

  it('joining puts you at the tail', () => {
    const s = join(initSim(station('st-03'), 1));
    expect(yourPosition(s)).toBe(s.line.length);
    expect(s.you).toBe('waiting');
    expect(s.youStartPos).toBe(s.line.length);
  });

  it('your position never goes backwards', () => {
    let s = join(initSim(station('st-10'), 3));
    let last = yourPosition(s);
    for (let i = 0; i < 400 && s.you === 'waiting'; i += 1) {
      s = tick(s);
      const pos = yourPosition(s);
      if (s.you === 'waiting') {
        expect(pos).toBeLessThanOrEqual(last);
        last = pos;
      }
    }
  });
});

describe('your turn', () => {
  it('a free port is held for you straight away when nobody is waiting', () => {
    const s = join(initSim(station('st-01'), 1));
    expect(s.you).toBe('called');
    const port = s.ports.find((p) => p.index === s.youPort)!;
    expect(port.held).toBe(true);
    expect(port.minsLeft).toBe(HOLD_MIN);
  });

  it('checking in starts a session, which ends with you done', () => {
    let s = checkIn(join(initSim(station('st-01'), 1)));
    expect(s.you).toBe('charging');
    expect(s.ports.find((p) => p.index === s.youPort)!.minsLeft).toBe(SESSION_MIN);
    s = run(s, SESSION_MIN);
    expect(s.you).toBe('done');
  });

  it('not checking in within the hold releases the port', () => {
    const s = run(join(initSim(station('st-01'), 1)), HOLD_MIN);
    expect(s.you).toBe('missed');
    expect(s.ports.some((p) => p.held)).toBe(false);
  });

  it('eventually reaches you from the back of a busy line', () => {
    const s = until(join(initSim(station('st-03'), 5)), (x) => x.you !== 'waiting');
    expect(s.you).toBe('called');
  });
});

describe('leaving', () => {
  it('removes you from the middle without reordering anyone else', () => {
    let s = initSim(station('st-03'), 2);
    s = join(s);
    s = { ...s, line: [...s.line, { id: 'x', plate: 'MH 12 ZZ 0001' }] }; // someone behind you
    const others = s.line.filter((d) => !d.you).map((d) => d.id);
    s = leave(s);
    expect(s.you).toBe('left');
    expect(s.line.map((d) => d.id)).toEqual(others);
  });

  it('giving up a held port frees it for the next driver', () => {
    const s = leave(join(initSim(station('st-01'), 1)));
    expect(s.you).toBe('left');
    expect(s.ports.some((p) => p.held)).toBe(false);
  });
});

describe('estimateWait', () => {
  const port = (status: SimPort['status'], minsLeft = 0): SimPort => ({
    index: 0, connectorType: 'CCS2', powerKw: 60, status, driver: null, minsLeft, held: false,
  });

  it('is zero with a free port and grows with position', () => {
    const ports = [port('free'), port('occupied', 12)];
    expect(estimateWait(ports, 1)).toBe(0);
    expect(estimateWait(ports, 2)).toBe(12);
    expect(estimateWait(ports, 3)).toBe(SESSION_MIN);
    expect(estimateWait(ports, 4)).toBe(12 + SESSION_MIN);
  });

  it('is infinite when every port is faulted', () => {
    expect(estimateWait([port('faulted')], 1)).toBe(Infinity);
  });
});

describe('clockLabel', () => {
  it('starts at 09:00 and rolls over hours', () => {
    expect(clockLabel(0)).toBe('09:00');
    expect(clockLabel(75)).toBe('10:15');
  });
});
