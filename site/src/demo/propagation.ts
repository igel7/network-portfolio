import type { GraphData } from './types';

// Stylised stress propagation on the bipartite graph (see memory/propagation.md).
// Every quantity here is illustrative: buffers derive from artificial link weights,
// stress is a number in [0, 1] and reaching 1 means "buffer exhausted", nothing more.

export interface PropagationParams {
  /** Buffer of a node as a share of its total link weight. */
  bufferRatio: number;
  /** Transmission factor from a beta node to its alpha neighbours. */
  lambda: number;
  /** Transmission factor from an alpha node to its beta neighbours. */
  mu: number;
  /** Stop when the total stress added in a round falls below this value. */
  tolerance: number;
  /** Safety cap on rounds. */
  maxRounds: number;
  /**
   * 'converge': nodes transmit every increment they receive (cumulative, until nothing changes).
   * 'once': DebtRank rule, each node transmits only in the round after it is first stressed.
   */
  mode: 'converge' | 'once';
}

export const DEFAULT_PARAMS: PropagationParams = Object.freeze({
  bufferRatio: 0.08,
  lambda: 0.45,
  mu: 0.2,
  tolerance: 1e-6,
  maxRounds: 50,
  mode: 'converge',
});

export interface AffectedNode {
  index: number;
  stress: number;
  /** stress × buffer: the node's absolute contribution to the impact. */
  impact: number;
}

export interface PropagationResult {
  seed: number;
  /** Stress of every node after each round; rounds[0] is the seeded state. */
  rounds: Float32Array[];
  /** Final stress of every node (same array as the last entry of rounds). */
  stress: Float32Array;
  /** Σ stress·buffer over all nodes except the seed, divided by Σ buffer over the same nodes. */
  impactShare: number;
  /** Nodes other than the seed with stress > 0, by impact descending. */
  affected: AffectedNode[];
  converged: boolean;
}

/** Buffer of every node: bufferRatio × total weight of its links. */
export function computeBuffers(data: GraphData, bufferRatio = DEFAULT_PARAMS.bufferRatio): Float64Array {
  const buffers = new Float64Array(data.nodes.length);
  data.edges.forEach((edge, e) => {
    const a = data.links[e * 2];
    const b = data.links[e * 2 + 1];
    buffers[a] += edge.weight;
    buffers[b] += edge.weight;
  });
  for (let i = 0; i < buffers.length; i++) buffers[i] *= bufferRatio;
  return buffers;
}

function validate(data: GraphData, seed: number, params: PropagationParams): void {
  if (!Number.isInteger(seed) || seed < 0 || seed >= data.nodes.length) throw new Error('Invalid seed index');
  const positive = ['bufferRatio', 'lambda', 'mu', 'tolerance'] as const;
  for (const key of positive) {
    if (!(params[key] > 0) || !Number.isFinite(params[key])) throw new Error(`Invalid parameter ${key}`);
  }
  if (!Number.isInteger(params.maxRounds) || params.maxRounds < 1) throw new Error('Invalid parameter maxRounds');
}

/**
 * Run the propagation from one seed node. Deterministic and side-effect free.
 * Each round, every node whose stress rose in the previous round passes the
 * increment to its neighbours, scaled by the link weight and the receiver's
 * buffer. Stress accumulates and is capped at 1, so the series converges.
 */
export function propagate(data: GraphData, seed: number, params: PropagationParams = DEFAULT_PARAMS, buffers = computeBuffers(data, params.bufferRatio)): PropagationResult {
  validate(data, seed, params);
  const n = data.nodes.length;
  const stress = new Float32Array(n);
  let delta = new Float32Array(n);
  stress[seed] = 1;
  delta[seed] = 1;
  const rounds: Float32Array[] = [stress.slice()];
  const transmitted = new Uint8Array(n);
  let converged = false;

  for (let round = 0; round < params.maxRounds; round++) {
    const incoming = new Float64Array(n);
    for (let e = 0; e < data.edges.length; e++) {
      const a = data.links[e * 2];
      const b = data.links[e * 2 + 1];
      const w = data.edges[e].weight;
      if (delta[b] > 0 && buffers[a] > 0) incoming[a] += params.lambda * w * delta[b] / buffers[a];
      if (delta[a] > 0 && buffers[b] > 0) incoming[b] += params.mu * w * delta[a] / buffers[b];
    }
    if (params.mode === 'once') for (let i = 0; i < n; i++) if (delta[i] > 0) transmitted[i] = 1;
    const next = new Float32Array(n);
    let added = 0;
    for (let i = 0; i < n; i++) {
      const value = Math.min(1, stress[i] + incoming[i]);
      const gained = value - stress[i];
      stress[i] = value;
      added += gained;
      // In 'once' mode a node that already transmitted keeps receiving stress but never transmits again.
      next[i] = params.mode === 'once' && transmitted[i] ? 0 : gained;
    }
    delta = next;
    if (added < params.tolerance) { converged = true; break; }
    rounds.push(stress.slice());
  }

  let impact = 0;
  let total = 0;
  const affected: AffectedNode[] = [];
  for (let i = 0; i < n; i++) {
    if (i === seed) continue;
    total += buffers[i];
    if (stress[i] > 0) {
      const contribution = stress[i] * buffers[i];
      impact += contribution;
      affected.push({ index: i, stress: stress[i], impact: contribution });
    }
  }
  affected.sort((x, y) => y.impact - x.impact || x.index - y.index);
  return { seed, rounds, stress, impactShare: total > 0 ? impact / total : 0, affected, converged };
}

/** Impact share of every node as a seed. O(nodes × edges × rounds); run off the main thread for large graphs. */
export function impactScores(data: GraphData, params: PropagationParams = DEFAULT_PARAMS): Float32Array {
  const buffers = computeBuffers(data, params.bufferRatio);
  const scores = new Float32Array(data.nodes.length);
  for (let i = 0; i < scores.length; i++) scores[i] = propagate(data, i, params, buffers).impactShare;
  return scores;
}
