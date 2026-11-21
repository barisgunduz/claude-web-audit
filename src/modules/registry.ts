import type { Check } from '../model/check.js';
import { a11yModule } from './a11y/index.js';
import { aiModule } from './ai/index.js';
import { contentModule } from './content/index.js';
import { emailModule } from './email/index.js';
import { headersModule } from './headers/index.js';
import { linksModule } from './links/index.js';
import { MODULE_NAMES, type ModuleName } from './names.js';
import { seoModule } from './seo/index.js';
import { speedModule } from './speed/index.js';
import { sslModule } from './ssl/index.js';
import type { ModuleDefinition } from './types.js';

export const MODULES: Readonly<Record<ModuleName, ModuleDefinition>> = {
  links: linksModule,
  ssl: sslModule,
  headers: headersModule,
  seo: seoModule,
  content: contentModule,
  speed: speedModule,
  a11y: a11yModule,
  email: emailModule,
  ai: aiModule,
};

/** Every check of every module, in module order. */
export const CHECKS: readonly Check[] = MODULE_NAMES.flatMap((name) => MODULES[name].checks);

export function checkCodes(): string[] {
  return CHECKS.flatMap((check) => [...check.codes]);
}
