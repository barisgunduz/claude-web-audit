import type { PageRecord } from '../model/crawl.js';
import { loadPage } from '../crawler/dom.js';

export type JsonLdNode = Record<string, unknown>;

export interface JsonLdBlock {
  /** The top-level object, or the entries of a top-level array. */
  roots: JsonLdNode[];
  valid: boolean;
}

function isNode(value: unknown): value is JsonLdNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBlocks(page: PageRecord): JsonLdBlock[] {
  const $ = loadPage(page);
  if (!$) return [];
  const blocks: JsonLdBlock[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const roots = (Array.isArray(parsed) ? parsed : [parsed]).filter(isNode);
      blocks.push({ roots, valid: roots.length > 0 });
    } catch {
      blocks.push({ roots: [], valid: false });
    }
  });
  return blocks;
}

/** Every object that has its own @type, including the members of @graph. */
export function flattenNodes(roots: readonly JsonLdNode[]): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (node: JsonLdNode): void => {
    nodes.push(node);
    const graph = node['@graph'];
    if (Array.isArray(graph)) graph.filter(isNode).forEach(visit);
  };
  roots.forEach(visit);
  return nodes;
}

export function typesOf(node: JsonLdNode): string[] {
  const type = node['@type'];
  const values = Array.isArray(type) ? type : [type];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/^.*[/#]/, ''));
}

export function hasValue(node: JsonLdNode, property: string): boolean {
  const value = node[property];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
