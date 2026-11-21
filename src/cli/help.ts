import { COMMANDS, describeDefault, PARAMS, type ParamSpec } from './params.js';

function label(spec: ParamSpec): string {
  return spec.valueName ? `--${spec.flag} <${spec.valueName}>` : `--${spec.flag}`;
}

function columns(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}

export function buildHelp(version: string): string {
  const commandRows = COMMANDS.filter((command) => command.name !== 'audit').map(
    (command) => [command.usage.replace(/^cwa /, ''), command.description] as const,
  );
  const optionRows = [
    ...PARAMS.map(
      (spec) => [label(spec), `${spec.description} (default: ${describeDefault(spec)})`] as const,
    ),
    ['-h, --help', 'Show this help'] as const,
    ['-v, --version', 'Show the version'] as const,
  ];

  return [
    `cwa ${version}`,
    'Website audit for Claude Code.',
    '',
    'Usage:',
    '  cwa <domain> [options]',
    '  cwa <command> [arguments]',
    '',
    'Commands:',
    ...columns(commandRows),
    '',
    'Options:',
    ...columns(optionRows),
    '',
    'Environment:',
    '  PSI_API_KEY  Optional PageSpeed Insights API key. Read only from the environment.',
    '',
  ].join('\n');
}
