import { describe, expect, it } from 'vitest';
import { parseNetwork } from '../src/demo/data';
import { DEFAULT_PARAMS, computeBuffers, impactScores, propagate } from '../src/demo/propagation';

// alpha_1 -- beta_1 (w 1), alpha_1 -- beta_2 (w 20), alpha_2 -- beta_2 (w 30), alpha_3 -- beta_3 (w 5, separate component)
function graph() {
  return parseNetwork({
    nodes: [
      { id: 'alpha_1', label: 'A1', role: 'alpha' },
      { id: 'beta_1', label: 'B1', role: 'beta' },
      { id: 'alpha_2', label: 'A2', role: 'alpha' },
      { id: 'beta_2', label: 'B2', role: 'beta' },
      { id: 'alpha_3', label: 'A3', role: 'alpha' },
      { id: 'beta_3', label: 'B3', role: 'beta' },
    ],
    edges: [
      { source: 'alpha_1', target: 'beta_1', weight: 1, width: 1 },
      { source: 'alpha_1', target: 'beta_2', weight: 20, width: 1 },
      { source: 'alpha_2', target: 'beta_2', weight: 30, width: 1 },
      { source: 'alpha_3', target: 'beta_3', weight: 5, width: 1 },
    ],
  });
}
const idx = (g: ReturnType<typeof graph>, id: string) => g.idToIndex.get(id)!;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);

describe('computeBuffers', () => {
  it('is bufferRatio times the node weight total', () => {
    const g = graph();
    const b = computeBuffers(g, 0.08);
    close(b[idx(g, 'alpha_1')], 0.08 * 21);
    close(b[idx(g, 'beta_2')], 0.08 * 50);
    close(b[idx(g, 'beta_1')], 0.08 * 1);
  });
});

describe('propagate: hand-computed first rounds', () => {
  // Seed beta_1 (h = 1). Round 1: only alpha_1 receives λ·w·Δh/B = 0.45·1·1/1.68 = 0.267857.
  // Round 2: alpha_1's increment reaches beta_1 (already 1, capped) and beta_2:
  //   μ·20·0.267857/4.0 = 0.267857.
  it('matches the formula for the first two rounds', () => {
    const g = graph();
    const r = propagate(g, idx(g, 'beta_1'));
    const a1 = idx(g, 'alpha_1'), b2 = idx(g, 'beta_2'), a2 = idx(g, 'alpha_2');
    close(r.rounds[1][a1], 0.45 / 1.68);
    expect(r.rounds[1][b2]).toBe(0);
    expect(r.rounds[1][a2]).toBe(0);
    close(r.rounds[2][b2], 0.2 * 20 * (0.45 / 1.68) / 4);
    expect(r.rounds[2][a1]).toBeCloseTo(0.45 / 1.68, 5); // unchanged: nothing new reached it in round 2
  });

  it('never touches a disconnected component and excludes the seed from the impact share', () => {
    const g = graph();
    const r = propagate(g, idx(g, 'beta_1'));
    expect(r.stress[idx(g, 'alpha_3')]).toBe(0);
    expect(r.stress[idx(g, 'beta_3')]).toBe(0);
    expect(r.affected.some(n => n.index === r.seed)).toBe(false);
    expect(r.affected.some(n => n.index === idx(g, 'alpha_3'))).toBe(false);
    const b = computeBuffers(g);
    const others = [0, 2, 3, 4, 5].filter(i => i !== r.seed);
    const expected = others.reduce((s, i) => s + r.stress[i] * b[i], 0) / others.reduce((s, i) => s + b[i], 0);
    close(r.impactShare, expected);
  });
});

describe('propagate: properties', () => {
  const g = graph();
  const results = g.nodes.map((_, i) => propagate(g, i));

  it('keeps stress within [0, 1], seed at 1, and rounds monotone non-decreasing', () => {
    for (const r of results) {
      expect(r.stress[r.seed]).toBe(1);
      for (const round of r.rounds) for (const v of round) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      for (let t = 1; t < r.rounds.length; t++) for (let i = 0; i < g.nodes.length; i++) expect(r.rounds[t][i]).toBeGreaterThanOrEqual(r.rounds[t - 1][i]);
      expect(r.rounds[r.rounds.length - 1]).toEqual(r.stress);
    }
  });

  it('converges well within the round cap and is deterministic', () => {
    for (const r of results) { expect(r.converged).toBe(true); expect(r.rounds.length).toBeLessThan(DEFAULT_PARAMS.maxRounds); }
    const again = propagate(g, 1);
    expect(Array.from(again.stress)).toEqual(Array.from(results[1].stress));
  });

  it('orders affected nodes by impact descending with impactShare in [0, 1]', () => {
    for (const r of results) {
      expect(r.impactShare).toBeGreaterThanOrEqual(0);
      expect(r.impactShare).toBeLessThanOrEqual(1);
      for (let k = 1; k < r.affected.length; k++) expect(r.affected[k - 1].impact).toBeGreaterThanOrEqual(r.affected[k].impact);
    }
  });

  it('gives an isolated pair a smaller impact share than a hub', () => {
    const r3 = propagate(g, idx(g, 'alpha_3'));
    const r2 = propagate(g, idx(g, 'beta_2'));
    expect(r3.impactShare).toBeLessThan(r2.impactShare);
  });

  it('impactScores equals per-seed impact shares', () => {
    const scores = impactScores(g);
    results.forEach((r, i) => close(scores[i], r.impactShare));
  });

  it('rejects invalid seeds and parameters', () => {
    expect(() => propagate(g, -1)).toThrow();
    expect(() => propagate(g, 99)).toThrow();
    expect(() => propagate(g, 0, { ...DEFAULT_PARAMS, lambda: 0 })).toThrow();
    expect(() => propagate(g, 0, { ...DEFAULT_PARAMS, maxRounds: 0 })).toThrow();
  });
});

describe("propagate: 'once' mode", () => {
  const g = graph();
  it('lets a node transmit only once but still receive, and stays within bounds', () => {
    const once = propagate(g, idx(g, 'beta_1'), { ...DEFAULT_PARAMS, mode: 'once' });
    const conv = propagate(g, idx(g, 'beta_1'));
    expect(once.converged).toBe(true);
    for (let i = 0; i < g.nodes.length; i++) {
      expect(once.stress[i]).toBeLessThanOrEqual(conv.stress[i] + 1e-6);
      expect(once.stress[i]).toBeGreaterThanOrEqual(0);
    }
    // First round is identical in both modes.
    expect(Array.from(once.rounds[1])).toEqual(Array.from(conv.rounds[1]));
  });
});
