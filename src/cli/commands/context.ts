import type { Io } from '../io.js';
import type { ParsedArgs } from '../parse.js';

export interface CommandContext {
  parsed: ParsedArgs;
  io: Io;
}

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_NOT_IMPLEMENTED = 2;

export const NOT_IMPLEMENTED_MESSAGE =
  'This command is not implemented yet. See SCOPE.md for the roadmap.';

export function reportNotImplemented(io: Io): number {
  io.stderr(`${NOT_IMPLEMENTED_MESSAGE}\n`);
  return EXIT_NOT_IMPLEMENTED;
}
