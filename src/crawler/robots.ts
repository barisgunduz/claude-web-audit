export interface RobotsRule {
  type: 'allow' | 'disallow';
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  contentSignals: Record<string, string>;
  crawlDelay?: number;
}

export interface RobotsIssue {
  line: number;
  text: string;
  reason: string;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** Content-Signal directives that appear before any user-agent line. */
  fileContentSignals: Record<string, string>;
  issues: RobotsIssue[];
}

const KNOWN_DIRECTIVES = new Set([
  'user-agent',
  'allow',
  'disallow',
  'sitemap',
  'crawl-delay',
  'content-signal',
  'host',
  'clean-param',
  'request-rate',
  'visit-time',
]);

export function parseContentSignal(value: string): Record<string, string> {
  const signals: Record<string, string> = {};
  for (const part of value.split(',')) {
    const [name, setting] = part.split('=').map((piece) => piece.trim().toLowerCase());
    if (name && setting) signals[name] = setting;
  }
  return signals;
}

export function parseRobots(text: string): ParsedRobots {
  const parsed: ParsedRobots = { groups: [], sitemaps: [], fileContentSignals: {}, issues: [] };
  let current: RobotsGroup | undefined;
  let collectingAgents = false;

  text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (line === '') return;
      const lineNumber = index + 1;
      const colon = line.indexOf(':');
      if (colon < 1) {
        parsed.issues.push({ line: lineNumber, text: line, reason: 'Not a "field: value" line' });
        return;
      }
      const field = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();

      if (!KNOWN_DIRECTIVES.has(field)) {
        parsed.issues.push({
          line: lineNumber,
          text: line,
          reason: `Unknown directive "${field}"`,
        });
        return;
      }
      if (field === 'sitemap') {
        parsed.sitemaps.push(value);
        return;
      }
      if (field === 'user-agent') {
        if (!collectingAgents || !current) {
          current = { agents: [], rules: [], contentSignals: {} };
          parsed.groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        collectingAgents = true;
        return;
      }
      collectingAgents = false;
      if (field === 'content-signal') {
        Object.assign(
          current ? current.contentSignals : parsed.fileContentSignals,
          parseContentSignal(value),
        );
        return;
      }
      if (!current) {
        if (field === 'allow' || field === 'disallow') {
          parsed.issues.push({
            line: lineNumber,
            text: line,
            reason: 'Rule before any user-agent line',
          });
        }
        return;
      }
      if (field === 'allow' || field === 'disallow') {
        current.rules.push({ type: field, path: value });
      } else if (field === 'crawl-delay') {
        const delay = Number(value);
        if (Number.isFinite(delay)) current.crawlDelay = delay;
        else
          parsed.issues.push({
            line: lineNumber,
            text: line,
            reason: 'Crawl-delay is not a number',
          });
      }
    });

  return parsed;
}

/** Groups that apply to a crawler token. Specific groups win, the "*" group is the fallback. */
export function groupsFor(parsed: ParsedRobots, token: string): RobotsGroup[] {
  const name = token.toLowerCase();
  const specific = parsed.groups.filter((group) => group.agents.includes(name));
  if (specific.length > 0) return specific;
  return parsed.groups.filter((group) => group.agents.includes('*'));
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins, and Allow wins a tie. An empty Disallow allows everything. */
export function isAllowed(parsed: ParsedRobots, token: string, pathWithQuery: string): boolean {
  let best: { length: number; allow: boolean } | undefined;
  for (const group of groupsFor(parsed, token)) {
    for (const rule of group.rules) {
      if (rule.path === '') continue;
      if (!patternToRegExp(rule.path).test(pathWithQuery)) continue;
      const allow = rule.type === 'allow';
      if (!best || rule.path.length > best.length || (rule.path.length === best.length && allow)) {
        best = { length: rule.path.length, allow };
      }
    }
  }
  return best?.allow ?? true;
}

export function contentSignalsFor(parsed: ParsedRobots): Record<string, string> {
  const merged: Record<string, string> = { ...parsed.fileContentSignals };
  for (const group of parsed.groups) {
    if (group.agents.includes('*')) Object.assign(merged, group.contentSignals);
  }
  return merged;
}
