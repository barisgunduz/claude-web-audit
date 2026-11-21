import { reportNotImplemented, type CommandContext } from './context.js';

export function runInit({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
