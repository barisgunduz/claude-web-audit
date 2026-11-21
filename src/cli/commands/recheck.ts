import { reportNotImplemented, type CommandContext } from './context.js';

export function runRecheck({ io }: CommandContext): number {
  return reportNotImplemented(io);
}
