export const MODULE_NAMES = [
  'links',
  'ssl',
  'headers',
  'seo',
  'content',
  'speed',
  'a11y',
  'email',
  'ai',
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export function isModuleName(value: string): value is ModuleName {
  return (MODULE_NAMES as readonly string[]).includes(value);
}
