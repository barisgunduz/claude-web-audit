import type { Engine, Strategy } from '../cli/params.js';
import type { ModuleName } from '../modules/names.js';

export interface OutputsConfig {
  card?: boolean;
  social?: boolean;
  pdf?: boolean;
  fixPlan?: boolean;
}

export interface EmailConfig {
  dkimSelectors?: string[];
}

/** Shape of cwa.config.json. Every field is optional. */
export interface CwaConfig {
  domain?: string;
  pages?: number;
  prepared_by?: string;
  report_language?: string;
  engine?: Engine;
  strategy?: Strategy;
  runs?: number;
  delay?: number;
  concurrency?: number;
  thinContentWords?: number;
  speedPages?: number;
  a11yPages?: number;
  chromePath?: string;
  email?: EmailConfig;
  weights?: Partial<Record<ModuleName, number>>;
  modules?: ModuleName[];
  outputs?: OutputsConfig;
}

/** Fully resolved settings: command line, then config file, then defaults. */
export interface Settings {
  domain: string;
  pages: number;
  preparedBy: string;
  language: string;
  engine: Engine;
  strategy: Strategy;
  runs: number;
  delay: number;
  concurrency: number;
  thinContentWords: number;
  speedPages: number;
  a11yPages: number;
  chromePath: string | undefined;
  dkimSelectors: string[];
  weights: Record<ModuleName, number>;
  modules: ModuleName[];
  outputs: Required<OutputsConfig>;
  compare: string | undefined;
  out: string;
  failUnder: number | undefined;
  verbose: boolean;
}
