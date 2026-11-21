import { reportNotImplemented, type CommandContext } from './context.js';

export function runVerify({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
