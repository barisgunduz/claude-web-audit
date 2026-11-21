import type { Finding } from '../model/finding.js';
import type { Translate } from './index.js';

/** The message for a finding, with {name} placeholders filled from its data. */
export function renderFinding(finding: Finding, translate: Translate): string {
  const template = translate(`finding.${finding.code}`);
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = finding.data[name];
    return value === undefined ? placeholder : String(value);
  });
}
