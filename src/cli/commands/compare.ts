import { reportNotImplemented, type CommandContext } from './context.js';

export function runCompare({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
