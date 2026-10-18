/**
 * WattWay · Team Kothimbir 🌿
 * queueSim.ts — a seeded, step-by-step simulation of one station's virtual
 * queue, so the queue page can show a "live" line before the queue module
 * (Socket.IO + the server's linked-list queue) exists.
 *
 * Every function is pure: it takes a state and returns a new one. One `tick`
 * is one simulated minute. The same seed always replays the same day, which is
 * what makes it testable.
 */
import type { ConnectorType, PortStatus, Station } from '../services/stations';
import { SESSION_MIN } from './stations';

/** Minutes a free port is held for you once you reach the front. */
export const HOLD_MIN = 10;
/** Chance per simulated minute that another driver joins / someone gives up. */
export const P_JOIN = 0.06;
export const P_LEAVE = 0.025;
const LOG_LIMIT = 30;

export interface Driver {
  id: string;
  plate: string;
  you?: boolean;
}

export interface SimPort {
  index: number;
  connectorType: ConnectorType;
  powerKw: number;
  status: PortStatus;
  driver: Driver | null;
  /** Minutes until the session ends; for a port held for you, minutes left to check in. */
  minsLeft: number;
  held: boolean;
}

export type YouStatus = 'idle' | 'waiting' | 'called' | 'charging' | 'done' | 'missed' | 'left';

export interface LogEntry {
  id: number;
  t: number;
  text: string;
  /** The queue operation the server performs for this event, with its cost. */
  op?: string;
  mine?: boolean;
}

export interface SimState {
  t: number;
  seed: number;
  nextId: number;
  ports: SimPort[];
  /** Front of the line is index 0. */
  line: Driver[];
  you: YouStatus;
  youPort: number | null;
  /** Your position when you joined, for the progress bar. */
  youStartPos: number;
  log: LogEntry[];
}

// ─── Seeded randomness (mulberry32) ─────────────────────────────────────────

function rand(s: SimState): number {
  const t = (s.seed + 0x6d2b79f5) | 0;
  s.seed = t;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
function plate(s: SimState): string {
  const l = () => LETTERS[Math.floor(rand(s) * LETTERS.length)];
  return `MH ${rand(s) < 0.5 ? '12' : '14'} ${l()}${l()} ${String(1000 + Math.floor(rand(s) * 9000))}`;
}

function newDriver(s: SimState): Driver {
  s.nextId += 1;
  return { id: `d${s.nextId}`, plate: plate(s) };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Copy-on-write draft so every exported function stays pure. */
const draft = (s: SimState): SimState => ({
  ...s,
  ports: s.ports.map((p) => ({ ...p })),
  line: [...s.line],
  log: [...s.log],
});

function log(s: SimState, text: string, op?: string, mine?: boolean) {
  s.nextId += 1;
  s.log = [{ id: s.nextId, t: s.t, text, op, mine }, ...s.log].slice(0, LOG_LIMIT);
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function initSim(station: Station, seed = seedFrom(station.id)): SimState {
  const s: SimState = { t: 0, seed, nextId: 0, ports: [], line: [], you: 'idle', youPort: null, youStartPos: 0, log: [] };
  s.ports = station.ports.map((p) => ({
    index: p.index,
    connectorType: p.connectorType,
    powerKw: p.powerKw,
    status: p.status,
    driver: p.status === 'occupied' ? newDriver(s) : null,
    minsLeft: p.status === 'occupied' ? 6 + Math.floor(rand(s) * 30) : 0,
    held: false,
  }));
  s.line = Array.from({ length: station.queueLength }, () => newDriver(s));
  log(s, `Opened ${station.name}: ${s.line.length} waiting, ${s.ports.filter((p) => p.status === 'free').length} free`);
  return s;
}

/** Hand every free port to the front of the line, in port order. */
function assign(s: SimState) {
  for (const port of s.ports) {
    if (port.status !== 'free' || s.line.length === 0) continue;
    const d = s.line.shift() as Driver;
    port.status = 'occupied';
    port.driver = d;
    if (d.you) {
      port.held = true;
      port.minsLeft = HOLD_MIN;
      s.you = 'called';
      s.youPort = port.index;
      log(s, `Your turn: P${port.index + 1} is held for you for ${HOLD_MIN} min`, 'dequeue() · O(1) from the head', true);
    } else {
      port.held = false;
      port.minsLeft = 20 + Math.floor(rand(s) * 30);
      log(s, `${d.plate} moved from the front of the line to P${port.index + 1}`, 'dequeue() · O(1) from the head');
    }
  }
}

export const canJoin = (s: SimState) =>
  ['idle', 'done', 'missed', 'left'].includes(s.you) && s.ports.some((p) => p.status !== 'faulted');

export function join(prev: SimState): SimState {
  if (!canJoin(prev)) return prev;
  const s = draft(prev);
  s.line.push({ id: 'you', plate: 'You', you: true });
  s.you = 'waiting';
  s.youPort = null;
  s.youStartPos = s.line.length;
  log(s, `You joined the line at #${s.line.length}`, 'enqueue() · O(1) at the tail', true);
  assign(s);
  return s;
}

export function leave(prev: SimState): SimState {
  if (prev.you !== 'waiting' && prev.you !== 'called') return prev;
  const s = draft(prev);
  if (s.you === 'waiting') {
    const pos = s.line.findIndex((d) => d.you);
    s.line.splice(pos, 1);
    log(s, `You left the line from #${pos + 1}`, 'remove(node) · O(1) unlink', true);
  } else {
    const port = s.ports.find((p) => p.index === s.youPort) as SimPort;
    Object.assign(port, { status: 'free', driver: null, held: false, minsLeft: 0 });
    log(s, `You gave up your held port P${port.index + 1}`, undefined, true);
  }
  s.you = 'left';
  s.youPort = null;
  assign(s);
  return s;
}

export function checkIn(prev: SimState): SimState {
  if (prev.you !== 'called') return prev;
  const s = draft(prev);
  const port = s.ports.find((p) => p.index === s.youPort) as SimPort;
  port.held = false;
  port.minsLeft = SESSION_MIN;
  s.you = 'charging';
  log(s, `You plugged in at P${port.index + 1}`, undefined, true);
  return s;
}

/** One simulated minute. */
export function tick(prev: SimState): SimState {
  const s = draft(prev);
  s.t += 1;

  for (const port of s.ports) {
    if (port.status !== 'occupied') continue;
    port.minsLeft -= 1;
    if (port.minsLeft > 0) continue;
    const d = port.driver as Driver;
    if (port.held) {
      s.you = 'missed';
      log(s, `You didn’t check in at P${port.index + 1} in time, so it went to the next driver`, undefined, true);
    } else if (d.you) {
      s.you = 'done';
      log(s, `You finished charging at P${port.index + 1}`, undefined, true);
    } else {
      log(s, `${d.plate} finished charging at P${port.index + 1}`);
    }
    if (d.you) s.youPort = null;
    Object.assign(port, { status: 'free', driver: null, held: false, minsLeft: 0 });
  }

  if (rand(s) < P_JOIN) {
    const d = newDriver(s);
    s.line.push(d);
    log(s, `${d.plate} joined the line at #${s.line.length}`, 'enqueue() · O(1) at the tail');
  }

  const others = s.line.filter((d) => !d.you);
  if (others.length >= 2 && rand(s) < P_LEAVE) {
    const quitter = others[Math.floor(rand(s) * others.length)];
    const pos = s.line.indexOf(quitter);
    s.line.splice(pos, 1);
    log(s, `${quitter.plate} gave up and left from #${pos + 1}`, 'remove(node) · O(1) unlink');
  }

  assign(s);
  return s;
}

// ─── Read-outs ──────────────────────────────────────────────────────────────

export const yourPosition = (s: SimState) => s.line.findIndex((d) => d.you) + 1;

/**
 * Minutes until the driver at `position` (1-based) reaches a port: repeatedly
 * give the soonest-free port to the next driver. The server would keep port
 * free-times in a min-heap; with at most 32 ports a sort is plenty here.
 */
export function estimateWait(ports: SimPort[], position: number): number {
  const freeAt = ports
    .filter((p) => p.status !== 'faulted')
    .map((p) => (p.status === 'free' ? 0 : p.held ? p.minsLeft + SESSION_MIN : p.minsLeft));
  if (freeAt.length === 0) return Infinity;
  for (let k = 1; ; k += 1) {
    freeAt.sort((a, b) => a - b);
    if (k === position) return freeAt[0];
    freeAt[0] += SESSION_MIN;
  }
}

export function clockLabel(t: number, startHour = 9): string {
  const total = startHour * 60 + t;
  const h = Math.floor(total / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
