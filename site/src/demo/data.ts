import type { GraphData, GraphEdge, GraphNode } from './types';

function object(value: unknown, allowed: string[], required: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid network object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(record, key))) {
    throw new Error('Unexpected network schema');
  }
  return record;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid network text');
  return value;
}

function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Invalid visual weight');
  return value;
}

export function parseNetwork(input: unknown): GraphData {
  const root = object(input, ['nodes', 'edges', 'metadata'], ['nodes', 'edges']);
  if (root.metadata !== undefined) {
    const keys = ['description', 'period', 'weights', 'publication_status'];
    const metadata = object(root.metadata, keys, keys);
    keys.forEach(key => text(metadata[key]));
  }
  if (!Array.isArray(root.nodes) || !root.nodes.length || !Array.isArray(root.edges) || !root.edges.length) {
    throw new Error('Network must contain nodes and edges');
  }
  // Float32 indices must remain exact for the renderer.
  if (root.nodes.length > 16777216) throw new Error('Network exceeds index capacity');
  const idToIndex = new Map<string, number>();
  const nodes: GraphNode[] = root.nodes.map((value, index) => {
    const node = object(value, ['id', 'label', 'role'], ['id', 'label', 'role']);
    const id = text(node.id);
    if (idToIndex.has(id)) throw new Error('Duplicate node ID');
    if (node.role !== 'alpha' && node.role !== 'beta') throw new Error('Invalid node role');
    idToIndex.set(id, index);
    return { id, label: text(node.label), role: node.role };
  });
  const adjacency = nodes.map(() => [] as number[]);
  const incidentEdges = nodes.map(() => [] as number[]);
  const degrees = new Uint32Array(nodes.length);
  const links = new Float32Array(root.edges.length * 2);
  const seen = new Set<string>();
  const edges: GraphEdge[] = root.edges.map((value, index) => {
    const edge = object(value, ['source', 'target', 'weight', 'width'], ['source', 'target', 'weight', 'width']);
    const source = text(edge.source);
    const target = text(edge.target);
    const a = idToIndex.get(source);
    const b = idToIndex.get(target);
    if (a === undefined || b === undefined || nodes[a].role !== 'alpha' || nodes[b].role !== 'beta') {
      throw new Error('Invalid edge endpoints');
    }
    const key = `${a}:${b}`;
    if (seen.has(key)) throw new Error('Duplicate edge');
    seen.add(key);
    const result = { source, target, weight: positive(edge.weight), width: positive(edge.width) };
    links[index * 2] = a;
    links[index * 2 + 1] = b;
    adjacency[a].push(b);
    adjacency[b].push(a);
    incidentEdges[a].push(index);
    incidentEdges[b].push(index);
    degrees[a]++;
    degrees[b]++;
    return result;
  });
  const positions = new Float32Array(nodes.length * 2);
  let seed = 202501;
  for (let i = 0; i < positions.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    positions[i] = (seed / 4294967296) * 2000 - 1000;
  }
  return { nodes, edges, positions, links, adjacency, incidentEdges, idToIndex, degrees };
}

export async function loadNetwork(url: string, signal?: AbortSignal): Promise<GraphData> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Network request failed (${response.status})`);
  return parseNetwork(await response.json());
}
