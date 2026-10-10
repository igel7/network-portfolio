import { impactScores } from './propagation';
import type { GraphData } from './types';

self.onmessage = (event: MessageEvent<GraphData>) => {
  try {
    const scores = impactScores(event.data);
    self.postMessage({ scores });
  } catch {
    self.postMessage({ error: true });
  }
};
