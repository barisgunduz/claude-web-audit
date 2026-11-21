# Architecture

## Folder structure

```
src/
  cli/          entry point, parameter table, help, argument parser, one file per command
  config/       config types, defaults, validator, loader and the settings merge
  crawler/      site crawler (placeholder)
  modules/      one folder per module (placeholders)
  scoring/      scores and findings (placeholder)
  fixplan/      FIX_PLAN.md generator (placeholder)
  report/       PDF, card and social output (placeholder)
  i18n/         language files and the loader
templates/      report, card and social templates (later)
test/           unit tests
docs/           documentation
translations/   translated READMEs and guides
```

## Data flow

```
domain + settings
      |
   crawler  ->  pages, headers, links
      |
   modules  ->  findings and module scores (each can end as "not measured")
      |
   scoring  ->  total score
      |
  audit.json  (single source of truth)
      |
      +-> report.pdf
      +-> summary-card.png and summary-card.pdf
      +-> social-1.png to social-3.png
      +-> FIX_PLAN.md
```

`audit.json` is the only input of the report, the card and the social images. They never run their own measurements, so they can never disagree.

## Settings

`src/cli/params.ts` is the single table of parameters and defaults. The parser, the `--help` text and the settings merge read from it, and a test checks that `docs/parameters.md` mentions every flag and subcommand. The merge order is command line, config file, built-in defaults.

## Decisions

These come from SCOPE.md section 13:

- Node.js on the latest active LTS, pinned to major 26.
- TypeScript in strict mode, ESM, npm.
- Argument parsing with the built-in `util.parseArgs`.
- Vitest for tests, ESLint and Prettier for code quality.
- Lighthouse and axe-core are added later, in step 3 and step 4.
- Headless Chrome for PDF and PNG output, no other heavy runtime.

TypeScript is pinned to 6.0.3. The latest release is 7.0.2, but typescript-eslint 8.73 supports TypeScript below 6.1.0 only. The pin moves up when typescript-eslint supports TypeScript 7.

## Safety

- The API key is only read from the environment, and all terminal output is redacted for its value.
- The config validator rejects unknown fields, so a key in the config file is an error.
- The crawler obeys robots.txt, uses a polite request rate and stays on the given domain.
