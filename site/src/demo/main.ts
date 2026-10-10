import './styles.css';
import { loadNetwork } from './data';
import { createEngine, type NetworkEngine } from './engine';
import { createControls } from './controls';

const root = document.getElementById('network-demo-root');
if (root) {
  // Let controls and mobile details determine the shell frame's height.
  root.style.position = 'relative';
  root.style.inset = 'auto';
  const controls = createControls(root);
  const abort = new AbortController();
  let engine: NetworkEngine | undefined;
  let disposed = false;
  // Only a separately reviewed public asset may be placed at this URL.
  const url = `${import.meta.env.BASE_URL}data/network.json`;
  async function mount() {
    let loading = true;
    try {
      const data = await loadNetwork(url, abort.signal);
      loading = false;
      if (disposed) return;
      engine = await createEngine(controls.canvas, data, {
        onSelect: controls.select,
        onHover: controls.hover,
        onState: controls.state,
      });
      if (disposed) { engine.destroy(); return; }
      controls.bind(data, engine);
    } catch (error) {
      if (disposed) return;
      console.error('Network demo initialisation failed', error instanceof Error ? error.message : 'Unknown error');
      controls.error(loading
        ? 'The network data is unavailable or invalid. The reviewed graph may not be published yet. Please try again after the next demo update.'
        : 'The graph could not start. This browser or graphics device may not support the required WebGL features. Try a current desktop browser.');
    }
  }
  function dispose() {
    disposed = true; abort.abort(); engine?.destroy(); controls.destroy();
    window.removeEventListener('pagehide', onPageHide);
  }
  function onPageHide(event: PageTransitionEvent) { if (!event.persisted) dispose(); }
  window.addEventListener('pagehide', onPageHide);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  void mount();
}
