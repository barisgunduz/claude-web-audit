import { loadPage } from '../../crawler/dom.js';
import {
  flattenNodes,
  hasValue,
  readBlocks,
  typesOf,
  type JsonLdNode,
} from '../../checks/jsonld.js';
import { htmlPages, makeFinding, outcome } from '../../checks/support.js';
import type { Check } from '../../model/check.js';
import rules from './jsonld-rules.json' with { type: 'json' };

interface Rule {
  type: string;
  includeSubtypes?: boolean;
  required: string[];
  anyOf?: string[];
  recommended: string[];
  source: string;
}

const RULES: readonly Rule[] = rules.rules;

function subtypesOf(rule: Rule): string[] {
  if (!rule.includeSubtypes) return [rule.type];
  if (rule.type === 'LocalBusiness') return rules.localBusinessSubtypes;
  if (rule.type === 'Article') return rules.articleTypes;
  return [rule.type];
}

function listItemProblems(node: JsonLdNode): string[] {
  const entries = node.itemListElement;
  const items = (Array.isArray(entries) ? entries : [entries]).filter(
    (entry): entry is JsonLdNode => typeof entry === 'object' && entry !== null,
  );
  const problems: string[] = [];
  items.forEach((item, index) => {
    const inner = item.item;
    const innerName =
      typeof inner === 'object' && inner !== null && hasValue(inner as JsonLdNode, 'name');
    if (!hasValue(item, 'position')) problems.push('ListItem.position');
    if (!hasValue(item, 'name') && !innerName) problems.push('ListItem.name');
    if (!hasValue(item, 'item') && index < items.length - 1) problems.push('ListItem.item');
  });
  return [...new Set(problems)];
}

/** Properties a node is missing, as required and as recommended. */
export function missingProperties(node: JsonLdNode): { required: string[]; recommended: string[] } {
  const required: string[] = [];
  const recommended: string[] = [];
  const types = typesOf(node);
  for (const rule of RULES) {
    if (!subtypesOf(rule).some((type) => types.includes(type))) continue;
    required.push(...rule.required.filter((property) => !hasValue(node, property)));
    if (rule.anyOf && !rule.anyOf.some((property) => hasValue(node, property))) {
      required.push(`one of ${rule.anyOf.join(', ')}`);
    }
    recommended.push(...rule.recommended.filter((property) => !hasValue(node, property)));
    if (rule.type === 'BreadcrumbList') required.push(...listItemProblems(node));
  }
  return { required, recommended };
}

export const structuredData: Check = {
  id: 'seo.structured-data',
  module: 'seo',
  codes: ['SEO-021', 'SEO-022', 'SEO-023', 'SEO-047'],
  run(context) {
    const invalid: string[] = [];
    const incomplete: string[] = [];
    const missingRequired: string[] = [];
    const missingRecommended: string[] = [];
    let blocks = 0;
    for (const page of htmlPages(context)) {
      if (!loadPage(page)) continue;
      for (const block of readBlocks(page)) {
        blocks++;
        if (!block.valid) {
          invalid.push(page.url);
          continue;
        }
        for (const root of block.roots) {
          if (!hasValue(root, '@context')) incomplete.push(`${page.url}: missing @context`);
        }
        for (const node of flattenNodes(block.roots)) {
          if (typesOf(node).length === 0) {
            if (!('@graph' in node)) incomplete.push(`${page.url}: node without @type`);
            continue;
          }
          const missing = missingProperties(node);
          const label = typesOf(node).join('/');
          if (missing.required.length > 0)
            missingRequired.push(`${page.url}: ${label} lacks ${missing.required.join(', ')}`);
          if (missing.recommended.length > 0)
            missingRecommended.push(
              `${page.url}: ${label} lacks ${missing.recommended.join(', ')}`,
            );
        }
      }
    }
    const unique = (list: string[]): string[] => [...new Set(list)];
    return outcome(
      [
        ...(invalid.length > 0
          ? [makeFinding('seo', 'SEO-021', 'important', unique(invalid))]
          : []),
        ...(incomplete.length > 0
          ? [makeFinding('seo', 'SEO-022', 'important', unique(incomplete))]
          : []),
        ...(missingRequired.length > 0
          ? [makeFinding('seo', 'SEO-023', 'important', unique(missingRequired))]
          : []),
        ...(missingRecommended.length > 0
          ? [makeFinding('seo', 'SEO-047', 'improvement', unique(missingRecommended))]
          : []),
      ],
      { jsonLdBlocks: blocks },
    );
  },
};
