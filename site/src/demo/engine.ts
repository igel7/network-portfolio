import { Graph } from '@cosmos.gl/graph';
import type { GraphData } from './types';

type State = 'running' | 'frozen' | 'settled' | 'dragging';
interface Callbacks {
  onSelect(index: number | undefined): void;
  onHover(index: number | undefined, x?: number, y?: number): void;
  onState(state: State): void;
}
export interface NetworkEngine {
  start(): void;
  freeze(): void;
  reset(): void;
  fit(): void;
  select(index: number | undefined): void;
  stress(values?: Float32Array): void;
  scores(values: Float32Array): void;
  destroy(): void;
}

export async function createEngine(container: HTMLDivElement, data: GraphData, callbacks: Callbacks): Promise<NetworkEngine> {
  let intended: 'running' | 'frozen' | 'settled' = 'frozen';
  let dragging = false;
  let moved = false;
  let suppressClickUntil = 0;
  let destroyed = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const baseColors = new Float32Array(data.nodes.length * 4);
  data.nodes.forEach((node, i) => baseColors.set(node.role === 'alpha' ? [0.22, 0.83, 0.91, 1] : [1, 0.67, 0.26, 1], i * 4));
  const clearSettle = () => { clearTimeout(settleTimer); settleTimer = undefined; };
  const announce = (state: State) => { if (!destroyed) callbacks.onState(state); };
  const graph = new Graph(container, {
    backgroundColor: '#080d16', randomSeed: 2025, transitionDuration: 0,
    enableZoom: true, enableDrag: true, enableSimulationDuringZoom: true,
    fitViewOnInit: false, simulationDecay: 3500,
    simulationGravity: 0.12, simulationRepulsion: 1,
    simulationLinkSpring: 0.5, simulationLinkDistance: 18,
    simulationLinkDistRandomVariationRange: [1, 1],
    pointOpacity: 1, linkOpacity: 0.22,
    pointGreyoutOpacity: 0.12, linkGreyoutOpacity: 0.025,
    onClick: (index) => {
      if (dragging || performance.now() < suppressClickUntil) return;
      select(index);
      callbacks.onSelect(index);
    },
    onPointMouseOver: (index, _position, event) => {
      const source = event && ('sourceEvent' in event ? event.sourceEvent : event);
      const bounds = container.getBoundingClientRect();
      callbacks.onHover(index,
        source?.clientX === undefined ? undefined : source.clientX - bounds.left + 12,
        source?.clientY === undefined ? undefined : source.clientY - bounds.top + 12);
    },
    onPointMouseOut: () => callbacks.onHover(undefined),
    onSimulationTick: (alpha) => {
      // Keep forces alive even when a pointer is held still for a long drag.
      if (dragging && moved && alpha < 0.25) graph.start(0.45);
    },
    onSimulationEnd: () => {
      if (destroyed || (dragging && moved)) return;
      clearSettle();
      if (intended === 'frozen') { graph.pause(); announce('frozen'); }
      else { intended = 'settled'; announce('settled'); }
    },
    onDragStart: () => {
      dragging = true; moved = false;
      callbacks.onHover(undefined);
    },
    onDrag: (event) => {
      if (!moved && Math.abs(event.dx) + Math.abs(event.dy) > 0) {
        clearSettle();
        moved = true;
        graph.start(0.6); announce('dragging');
      }
    },
    onDragEnd: () => {
      dragging = false;
      if (!moved) {
        announce(intended); return;
      }
      if (moved) suppressClickUntil = performance.now() + 250;
      graph.start(0.35);
      if (intended === 'running') announce('running');
      else {
        announce('running');
        settleTimer = setTimeout(() => {
          if (destroyed || (dragging && moved)) return;
          graph.pause(); announce(intended);
        }, 1500);
      }
    },
  });
  function select(index: number | undefined) {
    graph.setConfigPartial({
      highlightedPointIndices: index === undefined ? undefined : [index, ...data.adjacency[index]],
      highlightedLinkIndices: index === undefined ? undefined : data.incidentEdges[index],
    });
  }
  try {
    await graph.ready;
    const colors = new Float32Array(data.nodes.length * 4);
    const sizes = new Float32Array(data.nodes.length);
    data.nodes.forEach((node, index) => {
      colors.set(node.role === 'alpha' ? [0.22, 0.83, 0.91, 1] : [1, 0.67, 0.26, 1], index * 4);
      sizes[index] = Math.min(10, 3 + Math.log2(1 + data.degrees[index]));
    });
    graph.setPointPositions(data.positions.slice());
    graph.setPointColors(colors);
    graph.setPointSizes(sizes);
    graph.setLinks(data.links);
    graph.setLinkStrength(new Float32Array(data.edges.length).fill(1));
    graph.setLinkWidths(Float32Array.from(data.edges, edge => edge.width));
    graph.setLinkColors(new Float32Array(data.edges.length * 4).map((_, index) => index % 4 === 3 ? 1 : 0.45));
    graph.render(1, 0);
    graph.fitView(0, 0.12, false);
    graph.pause(); announce('frozen');
  } catch (error) {
    graph.destroy(); throw error;
  }
  // Cosmos owns its canvas ResizeObserver; this observer also invalidates
  // container-driven layout changes without resetting positions or the view.
  const observer = new ResizeObserver(() => { if (!destroyed) graph.render(undefined, 0); });
  observer.observe(container);
  return {
    start() { clearSettle(); intended = 'running'; graph.start(0.6); announce(dragging ? 'dragging' : 'running'); },
    freeze() { clearSettle(); intended = 'frozen'; if (!dragging) { graph.pause(); announce('frozen'); } },
    reset() {
      clearSettle(); intended = 'running'; select(undefined); callbacks.onSelect(undefined);
      graph.setPointPositions(data.positions.slice()); graph.render(1, 0);
      graph.fitView(0, 0.12, true); graph.start(1); announce('running');
    },
    fit() { graph.fitView(350, 0.12, intended === 'running' || dragging); },
    select,
    stress(values) {
      const colors = baseColors.slice();
      if (values) for (let i = 0; i < values.length; i++) {
        const h = values[i];
        colors[i * 4] = colors[i * 4] * (1 - h) + h;
        colors[i * 4 + 1] *= 1 - h * 0.9;
        colors[i * 4 + 2] *= 1 - h * 0.8;
      }
      graph.setPointColors(colors); graph.render(undefined, 0);
    },
    scores(values) {
      graph.setPointSizes(Float32Array.from(values, value => 3 + 9 * Math.sqrt(value)));
      graph.render(undefined, 0);
    },
    destroy() { destroyed = true; clearSettle(); observer.disconnect(); graph.destroy(); },
  };
}
