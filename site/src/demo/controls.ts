import type { GraphData } from './types';
import type { NetworkEngine } from './engine';
import { computeBuffers, propagate, type PropagationResult } from './propagation';

export function createControls(root: HTMLElement) {
  root.innerHTML = `
    <section class="nd-app" aria-label="Interactive bipartite network">
      <div class="nd-toolbar" aria-label="Layout controls">
        <button class="nd-button" data-action="start" disabled>Start layout</button>
        <button class="nd-button" data-action="freeze" disabled>Freeze</button>
        <button class="nd-button" data-action="reset" disabled>Reset</button>
        <button class="nd-button" data-action="fit" disabled>Fit view</button>
        <button class="nd-button" data-action="clear" disabled>Clear selection</button>
        <span class="nd-status" role="status" aria-live="polite">Loading network…</span>
      </div>
      <div class="nd-workspace">
        <div class="nd-canvas" aria-label="Network canvas: drag nodes; pan the background; scroll to zoom">
          <div class="nd-tooltip" hidden></div>
        </div>
        <aside class="nd-panel" aria-label="Network details">
          <div class="nd-legend"><span><i class="nd-type-a"></i>Type A</span><span><i class="nd-type-b"></i>Type B</span></div>
          <p class="nd-metrics"></p>
          <div class="nd-details" aria-live="polite">Click a node to inspect its connections.</div>
          <section class="nd-propagation" hidden aria-label="Stylised stress propagation">
            <h3>Stress propagation</h3>
            <button class="nd-button" data-action="play">Pause rounds</button>
            <label>Round <input class="nd-round" type="range" min="0" max="0" value="0"></label>
            <p class="nd-impact" aria-live="polite"></p>
            <h3>Top affected nodes</h3><ol class="nd-top"></ol>
            <p>Stylised model using artificial weights. Red indicates stress; 100% stress is a cap, not a failure judgement. Impact share excludes the selected node.</p>
          </section>
          <p class="nd-score-status" role="status">Node size: degree. Impact scores pending.</p>
          <p>Drag a node to move its neighbours. Pan the background and scroll to zoom. Reset restores the initial scatter.</p>
        </aside>
      </div>
      <p class="nd-disclosure">Anonymised bipartite-network connectivity (source not disclosed); link widths represent independent artificial weights, not any observed quantity. Node size represents degree, not importance. Interactive demo in development.</p>
    </section>`;
  const canvas = root.querySelector<HTMLDivElement>('.nd-canvas')!;
  const status = root.querySelector<HTMLElement>('.nd-status')!;
  const details = root.querySelector<HTMLElement>('.nd-details')!;
  const tooltip = root.querySelector<HTMLElement>('.nd-tooltip')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-action]')];
  let graph: GraphData | undefined;
  let engine: NetworkEngine | undefined;
  let running = false;
  let result: PropagationResult | undefined;
  let buffers: Float64Array | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let round = 0;
  let worker: Worker | undefined;
  const panel = root.querySelector<HTMLElement>('.nd-propagation')!;
  const slider = root.querySelector<HTMLInputElement>('.nd-round')!;
  const play = root.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  function stop() { clearInterval(timer); timer = undefined; play.textContent = 'Play rounds'; }
  function showRound() {
    if (!result || !graph || !buffers) return;
    const values = result.rounds[round];
    engine?.stress(values);
    slider.value = String(round);
    let total = 0, impact = 0;
    const affected = [];
    for (let i = 0; i < values.length; i++) {
      if (i === result.seed) continue;
      total += buffers[i]; impact += values[i] * buffers[i];
      if (values[i] > 0) affected.push({ index: i, impact: values[i] * buffers[i] });
    }
    root.querySelector<HTMLElement>('.nd-impact')!.textContent = `Round ${round} / ${result.rounds.length - 1} · Impact share ${(total ? impact / total * 100 : 0).toFixed(2)}%${!result.converged ? ' · Round cap reached' : ''}`;
    const list = root.querySelector<HTMLElement>('.nd-top')!;
    list.replaceChildren();
    affected.sort((a, b) => b.impact - a.impact || a.index - b.index).slice(0, 10).forEach(item => {
      const li = document.createElement('li');
      li.textContent = `${graph!.nodes[item.index].label} · ${(values[item.index] * 100).toFixed(1)}% stress`;
      list.append(li);
    });
  }
  function animate() {
    stop(); if (!result) return;
    if (round === result.rounds.length - 1) round = 0;
    showRound(); play.textContent = 'Pause rounds';
    timer = setInterval(() => {
      if (!result || round >= result.rounds.length - 1) { stop(); return; }
      round++; showRound();
      if (round === result.rounds.length - 1) stop();
    }, 600);
  }
  function scrub() { stop(); round = Number(slider.value); showRound(); }
  slider.addEventListener('input', scrub);
  const actions: Record<string, () => void> = {
    start: () => engine?.start(), freeze: () => engine?.freeze(),
    reset: () => engine?.reset(), fit: () => engine?.fit(),
    clear: () => { engine?.select(undefined); select(undefined); },
    play: () => timer ? stop() : animate(),
  };
  function click(event: Event) {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.action) actions[target.dataset.action]?.();
  }
  root.addEventListener('click', click);
  function select(index: number | undefined) {
    stop(); result = undefined; panel.hidden = true; engine?.stress();
    details.replaceChildren();
    if (index === undefined || !graph) {
      details.textContent = 'Click a node to inspect its connections.';
      return;
    }
    const node = graph.nodes[index];
    const title = document.createElement('strong');
    title.textContent = node.label;
    const description = document.createElement('p');
    description.textContent = `${node.role === 'alpha' ? 'Type A' : 'Type B'} · ${graph.degrees[index].toLocaleString('en')} neighbours`;
    details.append(title, description);
    result = propagate(graph, index, undefined, buffers);
    panel.hidden = false; slider.max = String(result.rounds.length - 1); round = 0;
    engine?.select(undefined);
    animate();
  }
  return {
    canvas, select,
    bind(data: GraphData, instance: NetworkEngine) {
      graph = data; engine = instance;
      buffers = computeBuffers(data);
      root.querySelector<HTMLElement>('.nd-metrics')!.textContent = `${data.nodes.length.toLocaleString('en')} nodes · ${data.edges.length.toLocaleString('en')} links`;
      buttons.forEach(button => { button.disabled = false; });
      this.state('frozen');
      const scoreStatus = root.querySelector<HTMLElement>('.nd-score-status')!;
      scoreStatus.textContent = 'Node size: degree. Computing impact scores…';
      try {
        worker = new Worker(new URL('./impact.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ scores?: Float32Array; error?: boolean }>) => {
          if (event.data.scores) {
            engine?.scores(event.data.scores);
            scoreStatus.textContent = 'Node size: stylised impact score. Colour: type; red: stress.';
            root.querySelector<HTMLElement>('.nd-disclosure')!.textContent = 'Anonymised bipartite-network connectivity (source not disclosed); link widths represent artificial weights. Node size represents stylised impact share. Stress is illustrative, not a prediction. Interactive demo in development.';
          } else scoreStatus.textContent = 'Impact scores unavailable. Node size: degree.';
          worker?.terminate(); worker = undefined;
        };
        worker.onerror = () => { scoreStatus.textContent = 'Impact scores unavailable. Node size: degree.'; worker?.terminate(); worker = undefined; };
        worker.postMessage(data);
      } catch { scoreStatus.textContent = 'Impact scores unavailable. Node size: degree.'; }
    },
    state(state: 'running' | 'frozen' | 'settled' | 'dragging') {
      running = state === 'running';
      status.textContent = { running: 'Layout running', frozen: 'Layout frozen', settled: 'Layout settled', dragging: 'Dragging · neighbours responding' }[state];
      const start = root.querySelector<HTMLButtonElement>('[data-action="start"]')!;
      start.textContent = state === 'frozen' || state === 'settled' ? 'Start / resume' : 'Start layout';
      start.disabled = running;
    },
    hover(index: number | undefined, x?: number, y?: number) {
      tooltip.hidden = index === undefined || !graph;
      if (tooltip.hidden || !graph || index === undefined) return;
      tooltip.textContent = graph.nodes[index].label;
      tooltip.style.left = `${Math.max(8, Math.min(x ?? 16, canvas.clientWidth - 160))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(y ?? 16, canvas.clientHeight - 40))}px`;
    },
    error(message: string) {
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = 'Demo unavailable';
      canvas.replaceChildren();
      const note = document.createElement('p');
      note.className = 'nd-message nd-error';
      note.textContent = message;
      canvas.append(note);
    },
    destroy() { stop(); worker?.terminate(); slider.removeEventListener('input', scrub); root.removeEventListener('click', click); root.replaceChildren(); },
  };
}
