export type NodeRole = 'alpha' | 'beta';

export interface GraphNode {
  id: string;
  label: string;
  role: NodeRole;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  width: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Float32Array;
  links: Float32Array;
  adjacency: number[][];
  incidentEdges: number[][];
  idToIndex: Map<string, number>;
  degrees: Uint32Array;
}
