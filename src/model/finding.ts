import type { ModuleName } from '../modules/names.js';

export const SEVERITIES = ['critical', 'important', 'improvement'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A small data object. Its values fill the placeholders of the English message for the code. */
export type FindingData = Readonly<Record<string, string | number | boolean>>;

export interface Finding {
  /** Stable code such as LINK-004. The message is resolved from the language files. */
  code: string;
  module: ModuleName;
  severity: Severity;
  /** URLs or values that show the problem. */
  evidence: string[];
  data: FindingData;
}

export type ModuleStatus = 'measured' | 'partial' | 'not_measured';

export type FactValue = string | number | boolean | readonly string[] | readonly number[] | null;
export type Facts = Readonly<Record<string, FactValue>>;

export interface ModuleResult {
  module: ModuleName;
  status: ModuleStatus;
  /** Set when the status is partial or not_measured. */
  reason?: string;
  findings: Finding[];
  /** Raw counts the report needs later. */
  facts: Facts;
}
