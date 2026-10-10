import { describe, expect, it } from 'vitest';
import { parseNetwork } from '../src/demo/data';
import { DEFAULT_DETECTION, benjaminiHochbergThreshold, detectGroups, hypergeometricTail } from '../src/demo/detection';

// ---------- deterministic pseudo-random fixture generator ----------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

interface Planted { members: number[]; alphas: number[] }

/**
 * Random bipartite graph with heavy-tailed alpha degrees (a few hubs) plus
 * planted groups: each group is `size` beta nodes that all link to the same
 * `width` alpha nodes of moderate degree, in addition to their random links.
 */
function fixture(seed: number, opts: { alphas: number; betas: number; linksPerBeta: number; groups: number; size: number; width: number }) {
  const rand = rng(seed);
  const alphaWeights = Array.from({ length: opts.alphas }, (_, i) => 1 / Math.pow(i + 1, 0.9));
  const totalWeight = alphaWeights.reduce((a, b) => a + b, 0);
  const pickAlpha = () => { let r = rand() * totalWeight; for (let i = 0; i < alphaWeights.length; i++) { r -= alphaWeights[i]; if (r <= 0) return i; } return alphaWeights.length - 1; };
  const edges = new Set<string>();
  for (let b = 0; b < opts.betas; b++) {
    const k = 1 + Math.floor(rand() * (2 * opts.linksPerBeta - 1));
    for (let j = 0; j < k; j++) edges.add(`${pickAlpha()}:${b}`);
  }
  const planted: Planted[] = [];
  for (let g = 0; g < opts.groups; g++) {
    const members = Array.from({ length: opts.size }, (_, j) => opts.betas - 1 - (g * opts.size + j));
    // moderate-degree alphas: skip the first (hub) fifth
    const start = Math.floor(opts.alphas / 5);
    const alphas = Array.from({ length: opts.width }, (_, j) => start + g * opts.width + j);
    for (const m of members) for (const a of alphas) edges.add(`${a}:${m}`);
    planted.push({ members, alphas });
  }
  const nodes = [
    ...Array.from({ length: opts.alphas }, (_, i) => ({ id: `alpha_${i}`, label: `A${i}`, role: 'alpha' })),
    ...Array.from({ length: opts.betas }, (_, i) => ({ id: `beta_${i}`, label: `B${i}`, role: 'beta' })),
  ];
  const edgeList = [...edges].map(key => { const [a, b] = key.split(':').map(Number); return { source: `alpha_${a}`, target: `beta_${b}`, weight: 1, width: 1 }; });
  const graph = parseNetwork({ nodes, edges: edgeList });
  const plantedIdx = planted.map(p => ({ members: p.members.map(b => graph.idToIndex.get(`beta_${b}`)!), alphas: p.alphas.map(a => graph.idToIndex.get(`alpha_${a}`)!) }));
  return { graph, planted: plantedIdx };
}

function evaluate(graph: ReturnType<typeof fixture>['graph'], planted: Planted[]) {
  const result = detectGroups(graph);
  const plantedNodes = new Set(planted.flatMap(p => p.members));
  const detectedNodes = new Set(result.groups.flatMap(g => g.members));
  let hit = 0; for (const node of detectedNodes) if (plantedNodes.has(node)) hit++;
  const precision = detectedNodes.size ? hit / detectedNodes.size : 1;
  const recall = plantedNodes.size ? hit / plantedNodes.size : 1;
  // group-level recall: a planted group counts as found if one detected group contains at least 80% of its members
  const groupsFound = planted.filter(p => result.groups.some(g => p.members.filter(m => g.members.includes(m)).length >= 0.8 * p.members.length)).length;
  return { result, precision, recall, groupsFound };
}

// ---------- unit tests ----------
describe('hypergeometricTail', () => {
  it('matches hand-computed values', () => {
    // N=10, K=4, n=3: P(X>=1) = 1 - C(6,3)/C(10,3) = 1 - 20/120
    expect(hypergeometricTail(1, 10, 4, 3)).toBeCloseTo(1 - 20 / 120, 10);
    // P(X>=3) = C(4,3)/C(10,3) = 4/120
    expect(hypergeometricTail(3, 10, 4, 3)).toBeCloseTo(4 / 120, 10);
    expect(hypergeometricTail(0, 10, 4, 3)).toBe(1);
    expect(hypergeometricTail(4, 10, 4, 3)).toBe(0);
  });
  it('is monotone decreasing in x and stays within [0, 1] for large arguments', () => {
    let previous = 1;
    for (let x = 0; x <= 60; x++) { const p = hypergeometricTail(x, 1502, 546, 61); expect(p).toBeLessThanOrEqual(previous + 1e-12); expect(p).toBeGreaterThanOrEqual(0); previous = p; }
  });
});

describe('benjaminiHochbergThreshold', () => {
  it('accepts the classic textbook set', () => {
    // m=5, q=0.05: sorted p = 0.001, 0.008, 0.039, 0.041, 0.09; thresholds 0.01, 0.02, 0.03, 0.04, 0.05 -> largest i with p<=iq/m is i=2
    expect(benjaminiHochbergThreshold([0.09, 0.001, 0.041, 0.008, 0.039], 0.05)).toBe(0.008);
    expect(benjaminiHochbergThreshold([0.5, 0.6], 0.05)).toBe(0);
    expect(benjaminiHochbergThreshold([], 0.05)).toBe(0);
  });
});

describe('detectGroups', () => {
  it('finds a single obvious planted group and nothing else in a tiny graph', () => {
    // 30 alphas; betas 0..2 all link to alphas 0..3; betas 3..29 link to one alpha each (a4..a29) so every alpha has degree 1..3
    const nodes = [...Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, label: `a${i}`, role: 'alpha' })), ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, label: `b${i}`, role: 'beta' }))];
    const edges = [];
    for (const b of [0, 1, 2]) for (const a of [0, 1, 2, 3]) edges.push({ source: `a${a}`, target: `b${b}`, weight: 1, width: 1 });
    for (let b = 3; b < 30; b++) edges.push({ source: `a${4 + ((b - 3) % 26)}`, target: `b${b}`, weight: 1, width: 1 });
    const g = parseNetwork({ nodes, edges });
    const r = detectGroups(g, { fdr: 0.05, minGroupSize: 3, nullModel: 'hypergeometric' });
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].members.map(i => g.nodes[i].id)).toEqual(['b0', 'b1', 'b2']);
    expect(r.groups[0].sharedNeighbours.map(i => g.nodes[i].id)).toEqual(['a0', 'a1', 'a2', 'a3']);
    expect(r.groups[0].links.length).toBe(3);
    expect(r.validated.every(l => l.a < l.b)).toBe(true);
  });

  it('is deterministic and rejects invalid parameters', () => {
    const { graph } = fixture(1, { alphas: 60, betas: 200, linksPerBeta: 3, groups: 2, size: 5, width: 4 });
    const a = detectGroups(graph), b = detectGroups(graph);
    expect(a.groups).toEqual(b.groups);
    expect(() => detectGroups(graph, { ...DEFAULT_DETECTION, fdr: 0 })).toThrow();
    expect(() => detectGroups(graph, { ...DEFAULT_DETECTION, minGroupSize: 1 })).toThrow();
    expect(() => detectGroups(graph, { ...DEFAULT_DETECTION, nullModel: 'other' as never })).toThrow();
  });

  it('reports few or no groups on a null graph without planted structure', () => {
    let falseGroups = 0;
    for (const seed of [11, 12, 13]) {
      const { graph } = fixture(seed, { alphas: 150, betas: 600, linksPerBeta: 4, groups: 0, size: 0, width: 0 });
      falseGroups += detectGroups(graph).groups.length;
    }
    expect(falseGroups).toBeLessThanOrEqual(1);
  });

  it('recovers strongly planted groups and reports weaker ones', () => {
    const report: string[] = [];
    let strong = { precision: 0, recall: 0, groupsFound: 0 };
    for (const width of [5, 8, 12]) {
      const runs = [21, 22, 23, 24, 25].map(seed => {
        const { graph, planted } = fixture(seed, { alphas: 150, betas: 600, linksPerBeta: 4, groups: 4, size: 6, width });
        return evaluate(graph, planted);
      });
      const mean = (f: (r: typeof runs[number]) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
      const summary = { precision: mean(r => r.precision), recall: mean(r => r.recall), groupsFound: mean(r => r.groupsFound) };
      report.push(`width ${width}: precision ${summary.precision.toFixed(2)} recall ${summary.recall.toFixed(2)} groups ${summary.groupsFound.toFixed(1)}/4`);
      if (width === 12) strong = summary;
    }
    console.log(`planted-group evaluation (5 seeds, 4 groups of 6 members, 150x600, FDR ${DEFAULT_DETECTION.fdr}, ${DEFAULT_DETECTION.nullModel}): ${report.join(' | ')}`);
    expect(strong.precision).toBeGreaterThanOrEqual(0.9);
    expect(strong.recall).toBeGreaterThanOrEqual(0.9);
    expect(strong.groupsFound).toBeGreaterThanOrEqual(3.5);
  });
});
