# Architecture

## Folder structure

```
src/
  cli/          entry point, parameter table, help, argument parser, one file per command
  config/       config types, defaults, validator, loader and the settings merge
  audit/        runs the crawler and the modules, writes audit.json, builds the terminal summary
  crawler/      http client, redirect tracing, robots.txt, sitemaps, TLS probe, the crawl loop
  model/        shared types: findings, module results, crawl result, checks
  checks/       helpers that several modules share (finding factory, JSON-LD reading)
  modules/      one folder per module, a registry and the runner
  scoring/      scores (placeholder, step 5)
  fixplan/      FIX_PLAN.md generator (placeholder, step 6)
  report/       PDF, card and social output (placeholder, step 7)
  i18n/         language files, the loader and the finding message renderer
templates/      report, card and social templates (later)
test/           unit and integration tests, with a local test server and fake DNS and TLS
docs/           documentation
translations/   translated READMEs and guides
```

## Data flow

```
domain + settings
      |
   crawler  ->  CrawlResult (pages, headers, redirects, robots, sitemaps, TLS, probes)
      |
   modules  ->  ModuleResult: status, findings and facts (each can end as "not measured")
      |
   scoring  ->  total score (step 5)
      |
  audit.json  (single source of truth)
      |
      +-> report.pdf
      +-> summary-card.png and summary-card.pdf
      +-> social-1.png to social-3.png
      +-> FIX_PLAN.md
```

`audit.json` is the only input of the report, the card and the social images. They never run their own measurements, so they can never disagree. In this version `audit.json` has the schema version `0-interim`. Step 5 finalizes it.

## Findings and messages

A finding has a stable code (for example `LINK-004`), a module, a severity, evidence (URLs or values) and a small data object. The finding does not hold text. The message is resolved from the language files by code (`finding.LINK-004` in `src/i18n/en.json`), and a missing translation falls back to English.

A check is an object with an id, a module, the list of codes it can produce and a `run` function. Every check is in the registry of its module (`src/modules/<name>/index.ts`). The runner fails loudly when a check produces a code it did not declare. A test fails when a code has no English message or no row in `docs/checks.md`.

A check that throws makes its module "partial". A module whose checks all fail becomes "not measured". Neither stops the audit.

## Dependencies

Runtime dependencies are kept to a minimum. Everything else comes from Node: `fetch`, `node:tls`, `node:dns/promises`, `node:zlib`, `node:crypto` and `node:util`.

| Package | Version | Why |
| --- | --- | --- |
| undici | 8.13.1 | Node's built-in `fetch` cannot be given a custom DNS lookup. undici's `Agent` can, and that lookup is where private addresses are refused, in the same step that opens the connection. The audit uses undici's `fetch` with that agent. |
| cheerio | 1.2.0 | Parses HTML and sitemap XML with CSS selectors. It is built on parse5, which follows the HTML specification, so broken markup is read the way browsers read it. |

robots.txt is parsed by our own code (`src/crawler/robots.ts`) and not by a package. The checks need the raw groups of the file (to report the status of each AI bot, to read Content-Signal lines and to list syntax problems), and the popular parsers only answer "is this URL allowed". The parser follows the longest match rule with `*` and `$` wildcards.

## Settings

`src/cli/params.ts` is the single table of parameters and defaults. The parser, the `--help` text and the settings merge read from it, and a test checks that `docs/parameters.md` mentions every flag and subcommand. The merge order is command line, config file, built-in defaults.

## Decisions

These come from SCOPE.md section 13:

- Node.js on the latest active LTS, pinned to major 26.
- TypeScript in strict mode, ESM, npm.
- Argument parsing with the built-in `util.parseArgs`.
- Vitest for tests, ESLint and Prettier for code quality.
- Lighthouse and axe-core are added later, in step 4.
- Headless Chrome for PDF and PNG output, no other heavy runtime.

TypeScript is pinned to 6.0.3. The latest release is 7.0.2, but typescript-eslint 8.73 supports TypeScript below 6.1.0 only. The pin moves up when typescript-eslint supports TypeScript 7.

## Safety

- The API key is only read from the environment, and all terminal output is redacted for its value. The audit does not read it in this version.
- The config validator rejects unknown fields, so a key in the config file is an error.
- The crawler obeys robots.txt, uses a polite request rate and stays on the given domain. If the given domain redirects to another site, the audit stops with a message and does not crawl the other site. A canonical host on a non-default port is not accepted.
- Requests to private addresses are refused: `localhost`, `*.local`, `*.internal`, loopback, link-local (including 169.254.169.254), private and reserved IPv4 ranges, and IPv6 in every written form. IPv6 addresses are read as 16 bytes, so IPv4-mapped (`::ffff:127.0.0.1` and its hex form `::ffff:7f00:1`), IPv4-compatible, NAT64, 6to4 and Teredo addresses are judged by the IPv4 address they carry. Written hosts are checked first. For names, the check runs inside the DNS lookup that the socket itself uses (`src/crawler/guarded-fetch.ts`), so the address that was checked is the address that is connected to, and a name is never resolved a second time. A name with even one private address is refused. This covers redirects and external links, so a hostile site cannot point the audit at an internal service, and DNS rebinding does not work. If the audited domain is itself private (for example `localhost`), private addresses are allowed for that audit. Tests that inject their own fetch bypass this transport.
- robots.txt patterns are matched with a linear wildcard matcher and not with regular expressions, rules longer than 2048 characters are ignored, and a file is read up to 20,000 rules. A hostile robots.txt cannot make the audit slow.
- SPF checks stop asking DNS as soon as the count passes the limit of 10 lookups, so a hostile chain of includes cannot make the audit send endless queries.
- Page bodies are capped at 5 MB, sitemaps at 50 MB, external links at 200 URLs, and every request has a 15 second timeout.
