import { reportNotImplemented, type CommandContext } from './context.js';

export function runList({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
