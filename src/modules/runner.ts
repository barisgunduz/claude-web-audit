import type { CheckContext } from '../model/check.js';
import type { Facts, ModuleResult } from '../model/finding.js';
import type { ModuleDefinition } from './types.js';

export class UnknownCodeError extends Error {
  override readonly name = 'UnknownCodeError';
}

/** Runs the checks of one module. A failing check makes the module partial, never the audit fail. */
export async function runModule(
  definition: ModuleDefinition,
  context: CheckContext,
): Promise<ModuleResult> {
  if (definition.notMeasuredReason !== undefined) {
    return {
      module: definition.name,
      status: 'not_measured',
      reason: definition.notMeasuredReason,
      findings: [],
      facts: {},
    };
  }

  const findings: ModuleResult['findings'] = [];
  const reasons: string[] = [];
  let facts: Facts = {};
  let measured = 0;

  for (const check of definition.checks) {
    try {
      const result = await check.run(context);
      for (const finding of result.findings) {
        if (!check.codes.includes(finding.code)) {
          throw new UnknownCodeError(`Check ${check.id} produced undeclared code ${finding.code}`);
        }
      }
      findings.push(...result.findings);
      facts = { ...facts, ...result.facts };
      if (result.notMeasured === undefined) measured++;
      else reasons.push(`${check.id}: ${result.notMeasured}`);
      if (result.partial !== undefined) reasons.push(`${check.id}: ${result.partial}`);
    } catch (error) {
      if (error instanceof UnknownCodeError) throw error;
      reasons.push(`${check.id}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  const status = measured === 0 ? 'not_measured' : reasons.length > 0 ? 'partial' : 'measured';
  return {
    module: definition.name,
    status,
    ...(reasons.length > 0 && { reason: reasons.join('; ') }),
    findings,
    facts,
  };
}
