export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AxeViolation {
  id: string;
  impact: AxeImpact | null;
  help: string;
  helpUrl: string;
  /** One CSS selector per affected element. Frames and shadow roots are joined with " >> ". */
  selectors: string[];
}

export interface AxePageResult {
  url: string;
  violations: AxeViolation[];
  /** Set when the page could not be tested. */
  error?: string;
}

export interface AxeRun {
  axeVersion: string;
  pages: AxePageResult[];
}

/** Runs axe-core page by page in Chrome. Tests replace it with a fake. */
export interface AxeRunner {
  run(urls: readonly string[]): Promise<AxeRun>;
}
