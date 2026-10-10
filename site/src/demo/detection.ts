import type { GraphData } from './types';

// Statistically validated projection (see memory/hidden-groups.md).
// For every pair of beta nodes that share at least one alpha neighbour, the
// number of shared neighbours is tested against a degree-preserving null
// (hypergeometric). Pairs that survive Benjamini-Hochberg control form the
// validated network; its connected components are the reported groups.

export interface DetectionParams {
  /** False-discovery-rate level for Benjamini-Hochberg. */
  fdr: number;
  /** Smallest component reported as a group. */
  minGroupSize: number;
  /**
   * 'degree-class': Tumminello et al. (2011) treatment of a heterogeneous alpha side: alphas are
   *   binned by degree (powers of two), the hypergeometric test runs separately inside each bin,
   *   and a pair is validated if any of its bin tests survives the joint FDR control.
   * 'hypergeometric': one test per pair over all alphas (ignores alpha-degree heterogeneity; hubs
   *   create a giant validated component on the public graph).
   * 'configuration': Poisson tail on the Chung-Lu expected overlap (conditions on both degree
   *   sequences; on the public graph it validates almost nothing).
   */
  nullModel: 'degree-class' | 'hypergeometric' | 'configuration';
}

export const DEFAULT_DETECTION: DetectionParams = Object.freeze({ fdr: 0.01, minGroupSize: 3, nullModel: 'degree-class' });

export interface ValidatedLink {
  /** Beta node indices, a < b. */
  a: number;
  b: number;
  shared: number;
  pValue: number;
}

export interface DetectedGroup {
  /** Beta node indices in the group. */
  members: number[];
  links: ValidatedLink[];
  /** Alpha node indices adjacent to at least two members. */
  sharedNeighbours: number[];
  /** Mean of -log10(p) over the group's validated links. */
  score: number;
}

export interface DetectionResult {
  groups: DetectedGroup[];
  validated: ValidatedLink[];
  testedPairs: number;
  /** Largest p-value accepted by the BH procedure, or 0 if none. */
  threshold: number;
}

/** log(n!) for n = 0..max, computed once. */
function logFactorials(max: number): Float64Array {
  const table = new Float64Array(max + 1);
  for (let n = 1; n <= max; n++) table[n] = table[n - 1] + Math.log(n);
  return table;
}

/**
 * P(X >= x) where X ~ Hypergeometric(population N, successes K, draws n).
 * Summed on the log scale from the mode down to avoid underflow.
 */
export function hypergeometricTail(x: number, N: number, K: number, n: number, lf = logFactorials(N)): number {
  if (x <= Math.max(0, n + K - N)) return 1;
  const hi = Math.min(K, n);
  if (x > hi) return 0;
  const logC = (a: number, b: number) => lf[a] - lf[b] - lf[a - b];
  const denominator = logC(N, n);
  let total = 0;
  for (let k = x; k <= hi; k++) total += Math.exp(logC(K, k) + logC(N - K, n - k) - denominator);
  return Math.min(1, total);
}

/** P(X >= x) for X ~ Poisson(lambda), summed on the log scale. */
export function poissonTail(x: number, lambda: number): number {
  if (x <= 0) return 1;
  if (lambda <= 0) return 0;
  // P(X >= x) = 1 - P(X <= x-1); compute the lower sum directly when small enough, otherwise the upper sum.
  let logTerm = -lambda; // log P(X = 0)
  let lower = 0;
  for (let k = 0; k < x; k++) { lower += Math.exp(logTerm); logTerm += Math.log(lambda) - Math.log(k + 1); }
  if (lower < 0.999) return Math.max(0, Math.min(1, 1 - lower));
  let upper = 0;
  for (let k = x; k < x + 200; k++) { upper += Math.exp(logTerm); logTerm += Math.log(lambda) - Math.log(k + 1); if (logTerm < -745) break; }
  return Math.max(0, Math.min(1, upper));
}

/** Benjamini-Hochberg: returns the largest p accepted at level q, or 0. */
export function benjaminiHochbergThreshold(pValues: ArrayLike<number>, q: number): number {
  const sorted = Array.from(pValues).sort((a, b) => a - b);
  const m = sorted.length;
  let threshold = 0;
  for (let i = m - 1; i >= 0; i--) {
    if (sorted[i] <= (q * (i + 1)) / m) { threshold = sorted[i]; break; }
  }
  return threshold;
}

function validateParams(params: DetectionParams): void {
  if (!(params.fdr > 0 && params.fdr < 1)) throw new Error('Invalid parameter fdr');
  if (!Number.isInteger(params.minGroupSize) || params.minGroupSize < 2) throw new Error('Invalid parameter minGroupSize');
  if (!['degree-class', 'hypergeometric', 'configuration'].includes(params.nullModel)) throw new Error('Invalid parameter nullModel');
}

/** Deterministic, side-effect free. Runs in well under a second for the public graph; use a Worker anyway. */
export function detectGroups(data: GraphData, params: DetectionParams = DEFAULT_DETECTION): DetectionResult {
  validateParams(params);
  const n = data.nodes.length;
  const isAlpha = data.nodes.map(node => node.role === 'alpha');
  let alphaCount = 0;
  for (let i = 0; i < n; i++) if (isAlpha[i]) alphaCount++;
  const lf = logFactorials(Math.max(1, alphaCount));

  // Degree class of every alpha: floor(log2(degree)); a single class when not in 'degree-class' mode.
  const classOf = new Int32Array(n);
  let classCount = 1;
  if (params.nullModel === 'degree-class') {
    for (let i = 0; i < n; i++) if (isAlpha[i]) { classOf[i] = Math.floor(Math.log2(Math.max(1, data.degrees[i]))); classCount = Math.max(classCount, classOf[i] + 1); }
  }
  const classSizes = new Int32Array(classCount);
  for (let i = 0; i < n; i++) if (isAlpha[i]) classSizes[classOf[i]]++;
  // Per-beta degree inside each class.
  const classDegree = new Int32Array(n * classCount);
  for (let i = 0; i < n; i++) if (isAlpha[i]) for (const beta of data.adjacency[i]) classDegree[beta * classCount + classOf[i]]++;

  // Shared-neighbour counts per beta pair and alpha class.
  const shared = new Map<number, Int32Array>(); // key = a * n + b with a < b
  for (let alpha = 0; alpha < n; alpha++) {
    if (!isAlpha[alpha]) continue;
    const betas = data.adjacency[alpha];
    const c = classOf[alpha];
    for (let x = 0; x < betas.length; x++) {
      for (let y = x + 1; y < betas.length; y++) {
        const a = Math.min(betas[x], betas[y]);
        const b = Math.max(betas[x], betas[y]);
        const key = a * n + b;
        let counts = shared.get(key);
        if (!counts) { counts = new Int32Array(classCount); shared.set(key, counts); }
        counts[c]++;
      }
    }
  }

  // Expected overlap under the bipartite configuration model depends only on the two beta degrees.
  let totalLinks = 0;
  const alphaDegrees: number[] = [];
  for (let i = 0; i < n; i++) if (isAlpha[i]) { totalLinks += data.degrees[i]; alphaDegrees.push(data.degrees[i]); }
  const lambdaCache = new Map<number, number>();
  const expectedOverlap = (ki: number, kj: number): number => {
    const key = Math.min(ki, kj) * 65536 + Math.max(ki, kj);
    let value = lambdaCache.get(key);
    if (value === undefined) {
      value = 0;
      for (const d of alphaDegrees) value += Math.min(1, ki * d / totalLinks) * Math.min(1, kj * d / totalLinks);
      lambdaCache.set(key, value);
    }
    return value;
  };

  // One p-value per (pair, class) test; a pair keeps its smallest p-value.
  const candidates: ValidatedLink[] = [];
  const allPValues: number[] = [];
  for (const [key, counts] of shared) {
    const a = Math.floor(key / n);
    const b = key - a * n;
    let total = 0;
    let best = 1;
    for (let c = 0; c < classCount; c++) {
      const count = counts[c];
      if (count === 0) continue;
      total += count;
      let pValue: number;
      if (params.nullModel === 'configuration') pValue = poissonTail(count, expectedOverlap(data.degrees[a], data.degrees[b]));
      else if (params.nullModel === 'hypergeometric') pValue = hypergeometricTail(count, alphaCount, data.degrees[a], data.degrees[b], lf);
      else pValue = hypergeometricTail(count, classSizes[c], classDegree[a * classCount + c], classDegree[b * classCount + c], lf);
      allPValues.push(pValue);
      if (pValue < best) best = pValue;
    }
    candidates.push({ a, b, shared: total, pValue: best });
  }

  const threshold = benjaminiHochbergThreshold(allPValues, params.fdr);
  const validated = threshold > 0 ? candidates.filter(c => c.pValue <= threshold) : [];
  validated.sort((x, y) => x.pValue - y.pValue || x.a - y.a || x.b - y.b);

  // Connected components of the validated network (union-find).
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const link of validated) { const ra = find(link.a), rb = find(link.b); if (ra !== rb) parent[ra] = rb; }

  const byRoot = new Map<number, number[]>();
  for (const link of validated) {
    const root = find(link.a);
    let members = byRoot.get(root);
    if (!members) { members = []; byRoot.set(root, members); }
    for (const node of [link.a, link.b]) if (!members.includes(node)) members.push(node);
  }

  const groups: DetectedGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < params.minGroupSize) continue;
    members.sort((x, y) => x - y);
    const memberSet = new Set(members);
    const links = validated.filter(l => memberSet.has(l.a));
    const neighbourCounts = new Map<number, number>();
    for (const m of members) for (const alpha of data.adjacency[m]) neighbourCounts.set(alpha, (neighbourCounts.get(alpha) ?? 0) + 1);
    const sharedNeighbours = [...neighbourCounts].filter(([, c]) => c >= 2).map(([alpha]) => alpha).sort((x, y) => x - y);
    const score = links.reduce((s, l) => s + -Math.log10(Math.max(l.pValue, 1e-300)), 0) / links.length;
    groups.push({ members, links, sharedNeighbours, score });
  }
  groups.sort((x, y) => y.members.length - x.members.length || y.score - x.score || x.members[0] - y.members[0]);

  return { groups, validated, testedPairs: allPValues.length, threshold };
}
