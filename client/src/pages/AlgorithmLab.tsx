/**
 * WattWay · Team Kothimbir 🌿
 * AlgorithmLab.tsx — compare Dijkstra, A*, Bellman-Ford, Floyd-Warshall and TSP
 * (exact vs nearest-neighbour) on the same road graph, and watch them search.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, DataTable, PageHead, Slider, type Column } from '../components/ui';
import { GraphCanvas } from '../components/lab/GraphCanvas';
import { BenchmarkChart } from '../components/lab/BenchmarkChart';
import { AlgorithmCards } from '../components/lab/AlgorithmCards';
import {
  compare,
  fetchGraph,
  runBenchmark,
  type AlgorithmId,
  type AlgorithmResult,
  type BenchmarkRow,
  type CompareResponse,
  type CostMode,
  type LabGraphData,
  type LabNode,
} from '../services/algorithms';
import {
  ALGORITHM_META,
  ALL_ALGORITHMS,
  farthestFrom,
  formatCost,
  formatMs,
  percentOver,
  pickStops,
} from '../utils/lab';
import '../styles/lab.css';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Nodes revealed per second for speed 1…10 (≈4 → ≈290). */
const rateFor = (speed: number): number => 4 * 1.6 ** (speed - 1);

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function AlgorithmLab() {
  // ── inputs ────────────────────────────────────────────
  const [nodeCount, setNodeCount] = useState(120);
  const [seed, setSeed] = useState(1);
  const [mode, setMode] = useState<CostMode>('distance');
  const [regen, setRegen] = useState(0.6);
  const [astarWeight, setAstarWeight] = useState(1);
  const [tspCount, setTspCount] = useState(6);
  const [speed, setSpeed] = useState(6);
  const [startId, setStartId] = useState('n0');
  const [endId, setEndId] = useState('n1');
  const [pick, setPick] = useState<'start' | 'end'>('end');
  const [visible, setVisible] = useState<Set<AlgorithmId>>(() => new Set(ALL_ALGORITHMS));
  const [explore, setExplore] = useState<Set<AlgorithmId>>(() => new Set<AlgorithmId>(['dijkstra', 'astar']));

  // ── server state ──────────────────────────────────────
  const [graph, setGraph] = useState<LabGraphData | null>(null);
  const [graphKey, setGraphKey] = useState('');
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bench, setBench] = useState<BenchmarkRow[]>([]);
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [benchStops, setBenchStops] = useState(8);

  // Debounce what drives network calls so dragging a slider doesn't fire a request per pixel.
  const dNodes = useDebounced(nodeCount, 250);
  const dRegen = useDebounced(regen, 250);
  const dWeight = useDebounced(astarWeight, 250);
  const dTsp = useDebounced(tspCount, 250);

  // ── 1. fetch the graph ────────────────────────────────
  const lastShape = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    fetchGraph(dNodes, seed, dRegen, controller.signal)
      .then((data) => {
        setGraph(data);
        setGraphKey(`${dNodes}:${seed}`);
        setError(null);
        const shape = `${dNodes}:${seed}`;
        if (shape !== lastShape.current) {
          // new graph → new default trip: node 0 to the farthest node
          lastShape.current = shape;
          setStartId('n0');
          setEndId(farthestFrom(data.nodes, 'n0'));
        }
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [dNodes, seed, dRegen]);

  const stops = useMemo(() => (graph ? pickStops(graph.nodes, dTsp, startId) : []), [graph, dTsp, startId]);

  // ── 2. run every algorithm on the same input ──────────
  const [playKey, setPlayKey] = useState(0);
  useEffect(() => {
    if (!graph || graphKey !== `${dNodes}:${seed}`) return;
    if (!graph.nodes.some((n) => n.id === startId) || !graph.nodes.some((n) => n.id === endId)) return;
    const controller = new AbortController();
    setBusy(true);
    compare(
      { nodes: dNodes, seed, mode, regenStrength: dRegen, astarWeight: dWeight, start: startId, end: endId, stops },
      controller.signal,
    )
      .then((data) => {
        setResult(data);
        setError(null);
        setPlayKey((k) => k + 1);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [graph, graphKey, dNodes, seed, mode, dRegen, dWeight, startId, endId, stops]);

  // ── 3. animate exploration ────────────────────────────
  const [progress, setProgress] = useState(Infinity);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef(0);
  const rateRef = useRef(rateFor(speed));
  rateRef.current = rateFor(speed);

  const allResults: AlgorithmResult[] = useMemo(() => (result ? [...result.pathfinding, ...result.tsp] : []), [result]);
  const maxExplored = useMemo(
    () => Math.max(0, ...allResults.filter((r) => explore.has(r.algorithm)).map((r) => r.visitedOrder.length)),
    [allResults, explore],
  );

  const play = useCallback(
    (force: boolean) => {
      cancelAnimationFrame(rafRef.current);
      if (maxExplored === 0 || (!force && prefersReducedMotion())) {
        setProgress(Infinity);
        setPlaying(false);
        return;
      }
      setProgress(0);
      setPlaying(true);
      let last = performance.now();
      let position = 0;
      const tick = (now: number): void => {
        position += (rateRef.current * (now - last)) / 1000;
        last = now;
        if (position >= maxExplored) {
          setProgress(Infinity);
          setPlaying(false);
          return;
        }
        setProgress(position);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [maxExplored],
  );

  useEffect(() => {
    if (playKey > 0) play(false);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playKey, play]);

  // ── helpers ───────────────────────────────────────────
  const onPick = (node: LabNode): void => {
    if (pick === 'start') {
      setStartId(node.id);
      setPick('end');
    } else {
      setEndId(node.id);
      setPick('start');
    }
  };

  const toggleExplore = (id: AlgorithmId): void =>
    setExplore((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggle = (id: AlgorithmId): void =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const unit = result?.graph.unit ?? 'km';
  const by = (id: AlgorithmId): AlgorithmResult | undefined => allResults.find((r) => r.algorithm === id);
  const astar = by('astar');
  const dij = by('dijkstra');
  const exact = by('tspExact');
  const optimalPath = result?.reference.pathCost ?? null;

  const columns: Column<AlgorithmResult>[] = [
    {
      key: 'algo',
      header: 'Algorithm',
      render: (r) => (
        <>
          <span className="swatch" style={{ background: ALGORITHM_META[r.algorithm].color }} aria-hidden="true" />{' '}
          {r.label}
        </>
      ),
    },
    { key: 'cost', header: `Path cost (${unit === 'km' ? 'km' : 'energy'})`, numeric: true, render: (r) => formatCost(r.cost, unit) },
    { key: 'nodes', header: 'Nodes explored', numeric: true, render: (r) => r.nodesExplored },
    { key: 'ops', header: 'Operations', numeric: true, render: (r) => r.operations.toLocaleString() },
    { key: 'ms', header: 'Runtime', numeric: true, render: (r) => formatMs(r.runtimeMs) },
    {
      key: 'opt',
      header: 'Optimal?',
      render: (r) =>
        r.optimal === null ? (
          <span className="badge">n/a</span>
        ) : r.optimal ? (
          <span className="badge badge-ok">Yes</span>
        ) : (
          <span className="badge badge-bad">No</span>
        ),
    },
  ];

  const caveats = allResults.filter((r) => r.optimal === false || r.notes.some((n) => /negative|heuristic/i.test(n)));

  const runBench = async (): Promise<void> => {
    setBenchBusy(true);
    setBenchError(null);
    try {
      const data = await runBenchmark({ sizes: [20, 50, 100, 200, 400], seed, mode, regenStrength: regen, repeats: 3 });
      setBench(data.rows);
      setBenchStops(data.tspStops);
    } catch (e) {
      setBenchError((e as Error).message);
    } finally {
      setBenchBusy(false);
    }
  };

  return (
    <div className="container">
      <PageHead eyebrow="the heart of the project" title="Algorithm lab">
        Six routing strategies, one road graph. Pick a start and end on the map, then watch Dijkstra spread in a
        circle while A* narrows to a cone — and see where each one gets the answer wrong.
      </PageHead>

      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="lab-layout">
        {/* ── controls ─────────────────────────────── */}
        <aside className="panel lab-controls" aria-label="Lab controls">
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="start">Start</label>
              <select id="start" className="select" value={startId} onChange={(e) => setStartId(e.target.value)}>
                {graph?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="end">End</label>
              <select id="end" className="select" value={endId} onChange={(e) => setEndId(e.target.value)}>
                {graph?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={mode === 'energy'} onChange={(e) => setMode(e.target.checked ? 'energy' : 'distance')} />
            Energy cost mode
          </label>
          <small className="muted">
            {mode === 'energy'
              ? 'Edge weights are energy, not km. Downhill roads can go negative — Dijkstra and A* can be wrong here.'
              : 'Edge weights are road length in km.'}
          </small>

          <Slider
            id="regen"
            label="Downhill regen strength"
            value={Math.round(regen * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            disabled={mode !== 'energy'}
            hint={mode === 'energy' ? 'Share of descent energy recovered by regenerative braking.' : 'Turn on energy cost mode to use this.'}
            onChange={(v) => setRegen(v / 100)}
          />

          <Slider
            id="astar"
            label="A* heuristic weight"
            value={astarWeight}
            min={1}
            max={5}
            step={0.1}
            format={(v) => `${v.toFixed(1)}×`}
            hint="1.0 = standard A*. Higher = faster, may not be optimal."
            onChange={setAstarWeight}
          />
          {astar && dij && (
            <p className="tradeoff" aria-live="polite">
              A* explored <strong>{astar.nodesExplored}</strong> nodes vs Dijkstra’s <strong>{dij.nodesExplored}</strong>
              {astar.cost !== null && optimalPath !== null && (
                <>
                  ; its path is{' '}
                  <strong>{percentOver(astar.cost, optimalPath) < 0.005 ? 'optimal' : `${percentOver(astar.cost, optimalPath).toFixed(1)}% longer`}</strong>.
                </>
              )}
            </p>
          )}

          <Slider
            id="tsp"
            label="TSP stops"
            value={tspCount}
            min={3}
            max={12}
            hint="Tour starts and ends at the start node."
            warning={
              tspCount > 10
                ? `Exact (Held-Karp) gets slow past ~10 stops — ${tspCount} stops means ${2 ** (tspCount - 1)} subsets${exact ? ` (took ${formatMs(exact.runtimeMs)})` : ''}.`
                : undefined
            }
            onChange={setTspCount}
          />

          <Slider
            id="nodes"
            label="Graph size"
            value={nodeCount}
            min={10}
            max={300}
            step={5}
            format={(v) => `${v} nodes`}
            onChange={setNodeCount}
          />

          <Slider id="speed" label="Animation speed" value={speed} min={1} max={10} format={(v) => `${v} / 10`} onChange={setSpeed} />

          <div className="row">
            <Button small variant="secondary" onClick={() => setSeed((s) => s + 1)}>
              New graph
            </Button>
            <Button small onClick={() => play(true)} disabled={!result || maxExplored === 0}>
              {playing ? 'Restart animation' : 'Replay animation'}
            </Button>
          </div>
          <fieldset className="lab-explore">
            <legend>Show explored nodes for</legend>
            {(['dijkstra', 'astar', 'bellmanFord'] as AlgorithmId[]).map((id) => (
              <label key={id} className="check">
                <input type="checkbox" checked={explore.has(id)} onChange={() => toggleExplore(id)} />
                <span className="swatch" style={{ background: ALGORITHM_META[id].color }} aria-hidden="true" />
                {ALGORITHM_META[id].short}
              </label>
            ))}
            <small className="muted">Bellman-Ford touches almost every node, so it’s off by default.</small>
          </fieldset>
        </aside>

        {/* ── map + results ────────────────────────── */}
        <div className="lab-main">
          <section className="panel" aria-label="Map">
            <div className="lab-legend" role="group" aria-label="Show or hide each algorithm">
              {ALL_ALGORITHMS.map((id) => (
                <label key={id} className="check">
                  <input type="checkbox" checked={visible.has(id)} onChange={() => toggle(id)} />
                  <span className="swatch" style={{ background: ALGORITHM_META[id].color }} aria-hidden="true" />
                  {ALGORITHM_META[id].short}
                </label>
              ))}
            </div>

            <div className="lab-map-wrap">
              {graph ? (
                <GraphCanvas
                  graph={graph}
                  results={allResults}
                  visible={visible}
                  explore={explore}
                  progress={progress}
                  mode={mode}
                  startId={startId}
                  endId={endId}
                  stops={stops}
                  showStops={visible.has('tspExact') || visible.has('tspNearestNeighbour')}
                  pickLabel={pick}
                  onPick={onPick}
                />
              ) : (
                <div className="lab-map placeholder">{error ? 'Graph unavailable' : 'Loading graph…'}</div>
              )}
              {busy && <span className="lab-busy badge badge-bolt">Running…</span>}
            </div>
            <p className="muted lab-help">
              Click a node to set the <strong>{pick}</strong>, or use the menus. Circles show nodes a search has
              explored (choose which on the left); numbered stops are the TSP tour.
              {mode === 'energy' && ' Teal roads have a downhill direction that returns energy.'}
            </p>
          </section>

          <section className="panel" aria-label="Results">
            <h2>Results</h2>
            <DataTable
              caption={`Same input, every algorithm · ${result?.graph.nodes ?? '…'} nodes, ${result?.graph.edges ?? '…'} directed edges`}
              columns={columns}
              rows={allResults}
              rowKey={(r) => r.algorithm}
              empty={error ? 'No results — see the message above.' : 'Running…'}
            />
            {caveats.length > 0 && (
              <ul className="lab-notes">
                {caveats.map((r) => (
                  <li key={r.algorithm}>
                    <span className="swatch" style={{ background: ALGORITHM_META[r.algorithm].color }} aria-hidden="true" />{' '}
                    <strong>{r.label}:</strong> {r.notes.filter((n) => /negative|heuristic/i.test(n)).join(' ') || 'Not optimal on this input.'}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="panel lab-bench" aria-label="Benchmark">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginBottom: '.1em' }}>Benchmark</h2>
            <p className="muted" style={{ margin: 0 }}>
              Runtime vs graph size, 20 → 400 nodes (median of 3 runs, log scale). Uses the current cost mode.
            </p>
          </div>
          <Button onClick={runBench} disabled={benchBusy}>
            {benchBusy ? 'Running…' : bench.length ? 'Run again' : 'Run benchmark'}
          </Button>
        </div>
        {benchError && (
          <div className="notice error" role="alert" style={{ marginTop: '1rem' }}>
            {benchError}
          </div>
        )}
        {bench.length > 0 && (
          <>
            <BenchmarkChart rows={bench} visible={visible} />
            <p className="muted lab-help">
              TSP lines use {benchStops} stops and exclude the shared all-pairs matrix build. Floyd-Warshall’s O(V³)
              pulls away from Dijkstra as the graph grows. Use the checkboxes above the map to hide lines.
            </p>
          </>
        )}
      </section>

      <section style={{ paddingBlock: '2rem 3rem' }} aria-label="About the algorithms">
        <h2>The six strategies</h2>
        <AlgorithmCards />
      </section>
    </div>
  );
}
