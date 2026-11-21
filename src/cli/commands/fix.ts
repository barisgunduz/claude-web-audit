import { reportNotImplemented, type CommandContext } from './context.js';

export function runFix({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
