export type BotPurpose = 'training' | 'search' | 'user';

export interface AiBot {
  /** The user-agent token as the vendor writes it. */
  token: string;
  vendor: string;
  purpose: BotPurpose;
}

/**
 * Names and purposes were read from each vendor's own documentation on 2026-11-21.
 * The source URL sits next to each group. User-triggered bots may ignore robots.txt,
 * the vendor pages say so, and the report only states what robots.txt declares.
 */
export const AI_BOTS: readonly AiBot[] = [
  // https://developers.openai.com/api/docs/bots
  { token: 'GPTBot', vendor: 'OpenAI', purpose: 'training' },
  { token: 'OAI-SearchBot', vendor: 'OpenAI', purpose: 'search' },
  { token: 'ChatGPT-User', vendor: 'OpenAI', purpose: 'user' },
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  { token: 'ClaudeBot', vendor: 'Anthropic', purpose: 'training' },
  { token: 'Claude-SearchBot', vendor: 'Anthropic', purpose: 'search' },
  { token: 'Claude-User', vendor: 'Anthropic', purpose: 'user' },
  // https://docs.perplexity.ai/guides/bots
  { token: 'PerplexityBot', vendor: 'Perplexity', purpose: 'search' },
  { token: 'Perplexity-User', vendor: 'Perplexity', purpose: 'user' },
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  { token: 'Google-Extended', vendor: 'Google', purpose: 'training' },
  // https://support.apple.com/en-us/119829
  { token: 'Applebot-Extended', vendor: 'Apple', purpose: 'training' },
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  { token: 'meta-externalagent', vendor: 'Meta', purpose: 'training' },
  { token: 'meta-webindexer', vendor: 'Meta', purpose: 'search' },
  { token: 'meta-externalfetcher', vendor: 'Meta', purpose: 'user' },
  // https://developer.amazon.com/amazonbot
  { token: 'Amazonbot', vendor: 'Amazon', purpose: 'training' },
  { token: 'Amzn-SearchBot', vendor: 'Amazon', purpose: 'search' },
  { token: 'Amzn-User', vendor: 'Amazon', purpose: 'user' },
];

/**
 * Content-Signal syntax as described in the Cloudflare announcement of 2025-09-24:
 * https://blog.cloudflare.com/content-signals-policy/
 * The formal specification at contentsignals.org could not be read, so unknown names are
 * reported as unrecognized and not as errors in the file.
 */
export const CONTENT_SIGNAL_NAMES = ['search', 'ai-input', 'ai-train'] as const;
export const CONTENT_SIGNAL_VALUES = ['yes', 'no'] as const;
