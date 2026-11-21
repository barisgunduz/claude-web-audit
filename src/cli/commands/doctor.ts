import { reportNotImplemented, type CommandContext } from './context.js';

export function runDoctor({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
