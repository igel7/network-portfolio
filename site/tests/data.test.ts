import { describe, expect, it } from 'vitest';
import { parseNetwork } from '../src/demo/data';

const metadata = {
  description: 'test',
  period: 'test',
  weights: 'test',
  publication_status: 'test',
};

function fixture() {
  return {
    metadata,
    nodes: [
      { id: 'alpha_1', label: 'Alpha 1', role: 'alpha' },
      { id: 'beta_1', label: 'Beta 1', role: 'beta' },
      { id: 'alpha_2', label: 'Alpha 2', role: 'alpha' },
      { id: 'beta_2', label: 'Beta 2', role: 'beta' },
    ],
    edges: [
      { source: 'alpha_1', target: 'beta_1', weight: 10, width: 1 },
      { source: 'alpha_1', target: 'beta_2', weight: 20, width: 2 },
      { source: 'alpha_2', target: 'beta_2', weight: 30, width: 3 },
    ],
  };
}

describe('parseNetwork: indexing and endpoint preservation', () => {
  const data = parseNetwork(fixture());

  it('maps every node ID to its array index', () => {
    data.nodes.forEach((node, index) => expect(data.idToIndex.get(node.id)).toBe(index));
    expect(data.idToIndex.size).toBe(4);
  });

  it('writes link endpoints as node indices in source order', () => {
    expect(data.links.length).toBe(data.edges.length * 2);
    data.edges.forEach((edge, i) => {
      expect(data.links[i * 2]).toBe(data.idToIndex.get(edge.source));
      expect(data.links[i * 2 + 1]).toBe(data.idToIndex.get(edge.target));
    });
  });

  it('keeps original edge strings and visual attributes', () => {
    expect(data.edges[1]).toEqual({ source: 'alpha_1', target: 'beta_2', weight: 20, width: 2 });
  });

  it('builds symmetric adjacency, incident edges and degrees', () => {
    const l1 = data.idToIndex.get('alpha_1')!;
    const b2 = data.idToIndex.get('beta_2')!;
    expect(data.adjacency[l1].sort()).toEqual([data.idToIndex.get('beta_1'), b2].sort());
    expect(data.adjacency[b2].sort()).toEqual([l1, data.idToIndex.get('alpha_2')].sort());
    expect(data.incidentEdges[b2].sort()).toEqual([1, 2]);
    expect(Array.from(data.degrees)).toEqual([2, 1, 1, 2]);
    const total = Array.from(data.degrees).reduce((a, b) => a + b, 0);
    expect(total).toBe(data.edges.length * 2);
  });

  it('produces deterministic seeded positions of the right size', () => {
    const again = parseNetwork(fixture());
    expect(data.positions.length).toBe(data.nodes.length * 2);
    expect(Array.from(again.positions)).toEqual(Array.from(data.positions));
    expect(data.positions.every(Number.isFinite)).toBe(true);
  });

  it('accepts input without metadata', () => {
    const input = fixture() as Record<string, unknown>;
    delete input.metadata;
    expect(() => parseNetwork(input)).not.toThrow();
  });
});

describe('parseNetwork: malformed input is rejected', () => {
  const cases: Array<[string, (input: ReturnType<typeof fixture>) => unknown]> = [
    ['non-object root', () => null],
    ['array root', () => []],
    ['unexpected root key', input => ({ ...input, extra: 1 })],
    ['missing edges', input => ({ metadata, nodes: input.nodes })],
    ['empty nodes', input => ({ ...input, nodes: [] })],
    ['empty edges', input => ({ ...input, edges: [] })],
    ['metadata missing a key', input => ({ ...input, metadata: { description: 'x' } })],
    ['metadata with extra key', input => ({ ...input, metadata: { ...metadata, seed: 1 } })],
    ['node with extra attribute', input => { (input.nodes[0] as Record<string, unknown>).amount = 5; return input; }],
    ['node missing label', input => { delete (input.nodes[0] as Partial<{ label: string }>).label; return input; }],
    ['empty node id', input => { input.nodes[0].id = '  '; return input; }],
    ['duplicate node id', input => { input.nodes[2].id = 'alpha_1'; return input; }],
    ['invalid role', input => { input.nodes[0].role = 'gamma'; return input; }],
    ['edge to unknown node', input => { input.edges[0].target = 'beta_9'; return input; }],
    ['alpha-to-alpha edge', input => { input.edges[0].target = 'alpha_2'; return input; }],
    ['beta-to-beta edge', input => { input.edges[0].source = 'beta_2'; return input; }],
    ['reversed role direction', input => { input.edges[0] = { ...input.edges[0], source: 'beta_1', target: 'alpha_1' }; return input; }],
    ['duplicate edge', input => { input.edges[1] = { ...input.edges[0] }; return input; }],
    ['zero weight', input => { input.edges[0].weight = 0; return input; }],
    ['negative width', input => { input.edges[0].width = -1; return input; }],
    ['non-finite weight', input => { input.edges[0].weight = Number.NaN; return input; }],
    ['string weight', input => { (input.edges[0] as Record<string, unknown>).weight = '10'; return input; }],
    ['edge with extra attribute', input => { (input.edges[0] as Record<string, unknown>).date = '2025-01-01'; return input; }],
    ['edge missing width', input => { delete (input.edges[0] as Partial<{ width: number }>).width; return input; }],
  ];

  for (const [name, mutate] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => parseNetwork(mutate(fixture()))).toThrow();
    });
  }
});
