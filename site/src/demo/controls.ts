import type { GraphData } from './types';
import type { NetworkEngine } from './engine';

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
  const actions: Record<string, () => void> = {
    start: () => engine?.start(), freeze: () => engine?.freeze(),
    reset: () => engine?.reset(), fit: () => engine?.fit(),
    clear: () => { engine?.select(undefined); select(undefined); },
  };
  function click(event: Event) {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.action) actions[target.dataset.action]?.();
  }
  root.addEventListener('click', click);
  function select(index: number | undefined) {
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
  }
  return {
    canvas, select,
    bind(data: GraphData, instance: NetworkEngine) {
      graph = data; engine = instance;
      root.querySelector<HTMLElement>('.nd-metrics')!.textContent = `${data.nodes.length.toLocaleString('en')} nodes · ${data.edges.length.toLocaleString('en')} links`;
      buttons.forEach(button => { button.disabled = false; });
      this.state('frozen');
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
    destroy() { root.removeEventListener('click', click); root.replaceChildren(); },
  };
}
