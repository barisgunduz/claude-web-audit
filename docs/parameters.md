# Parameters and commands

The command is `/cwa` inside Claude Code. The same arguments work on the command line as `cwa`.

## Usage

```
cwa <domain> [options]
cwa init
cwa doctor
cwa fix [audit]
cwa verify <task-id>
cwa recheck [domain]
cwa compare <a> <b>
cwa list [domain]
```

`<domain>` is `domain.com` or a full URL. It can be left out when `cwa.config.json` has a `domain`.

## Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `--lang <code>` | `en` | Language of report, card and social slides |
| `--by <name>` | empty | "Prepared by" name on the cover and footer. If empty the line is omitted. One free-text name, no logo in the first release. |
| `--pages <n>` | `150` | Maximum pages to crawl, 1 to 100000 |
| `--only <a,b>` | all | Run only these modules |
| `--skip <a,b>` | none | Skip these modules |
| `--engine <name>` | `auto` | `psi`, `lighthouse` or `auto` (`psi` if `PSI_API_KEY` is set, else local Lighthouse) |
| `--strategy <name>` | `both` | `mobile`, `desktop` or `both` |
| `--runs <n>` | `3` | Speed measurement repeats, 1 to 20. The median is used. |
| `--compare <last\|path>` | none | Compare with the previous audit. Without this flag no comparison is made. A folder path is also accepted. |
| `--card` | on | Write the one-screen summary card |
| `--no-card` | off | Do not write the summary card |
| `--social` | off | Write three 4:5 social images |
| `--no-pdf` | off | Write only `audit.json` and `FIX_PLAN.md` |
| `--no-fix-plan` | off | Do not write `FIX_PLAN.md` |
| `--out <dir>` | `./audits` | Output folder |
| `--config <file>` | `cwa.config.json` | Config file. A missing default file is ignored, a missing file given with this flag is an error. |
| `--delay <ms>` | `250` | Wait between requests, 0 to 60000 |
| `--fail-under <n>` | none | Exit with an error code if the total score is below n (for CI) |
| `--verbose` | off | Print detailed logs |
| `-h`, `--help` | | Show help |
| `-v`, `--version` | | Show the version |

Module names for `--only` and `--skip`: `links`, `ssl`, `headers`, `seo`, `content`, `speed`, `a11y`, `email`, `ai`.

The PageSpeed API key is never a parameter. It is read only from the `PSI_API_KEY` environment variable. It is never written to the repo, the report, the logs or any output file. If it appears in an error message by mistake, it is replaced with `[redacted]`.

The source of truth for this table is `src/cli/params.ts`. The `--help` text is generated from the same table.

## What works today

The audit command (`cwa <domain>`) runs the crawler and all nine modules. It uses `--pages`, `--only`, `--skip`, `--delay`, `--out`, `--config`, `--verbose`, `--engine`, `--strategy` and `--runs`. The other parameters are parsed and checked, and have no effect yet.

- `--engine`, `--strategy` and `--runs` control the speed module, see [speed-and-engines.md](speed-and-engines.md).
- Before the first Lighthouse measurement, the audit prints an estimate of the number of runs and a rough duration to the terminal (stderr).
- The speed and a11y modules need Chrome for local Lighthouse and axe-core. If Chrome is missing, the modules report "not measured" and point to `cwa doctor`.
- The PageSpeed API key is read from the `PSI_API_KEY` environment variable only. The Chrome path can come from `chromePath` in the config file or from `CHROME_PATH`.

The audit writes `audits/<domain>/<date>/audit.json` (schema version `0-interim`) and prints a summary of at most 10 lines, with the engine that was used and any fallback. Ctrl+C stops the crawl and closes Chrome, and the findings so far are still written.

`cwa doctor` checks the environment and exits with 0 when everything that the chosen engine needs is available, and with 1 otherwise. It uses `--engine` and `--config`.

## Subcommands

| Subcommand | What it does |
| --- | --- |
| `/cwa init` | Creates the config file by asking for domain, prepared-by name, language and page limit |
| `/cwa doctor` | Checks the environment (Chrome, Lighthouse, API key present, network) and names what is missing |
| `/cwa fix [audit]` | Makes Claude work through `FIX_PLAN.md` |
| `/cwa verify <task-id>` | Re-measures the acceptance criteria of one task |
| `/cwa recheck` | Re-runs the audit with the same settings and automatically compares it with the previous audit (same as running the audit with `--compare last`) |
| `/cwa compare <a> <b>` | Compares two stored audits |
| `/cwa list` | Lists stored audits for a domain |

## Config file

`cwa.config.json` holds the same settings. Command-line parameters override config values. See `cwa.config.example.json` for a complete example.

| Field | Meaning |
| --- | --- |
| `domain` | Site to audit |
| `pages` | Maximum pages to crawl |
| `prepared_by` | Optional "prepared by" name |
| `report_language` | Report language, default `en` |
| `engine` | `psi`, `lighthouse` or `auto` |
| `strategy` | `mobile`, `desktop` or `both` |
| `runs` | Speed measurement repeats |
| `delay` | Wait between requests in milliseconds |
| `concurrency` | Requests in flight at once, 1 to 8, default 4 |
| `speedPages` | Pages that get Lighthouse measurements: the home page plus the most linked pages, 1 to 10, default 3 |
| `a11yPages` | Pages that get an axe-core run: the home page plus the most linked pages, 1 to 50, default 10 |
| `chromePath` | Path of the Chrome executable. Without it, `CHROME_PATH` and then the common install locations are used. |
| `thinContentWords` | Pages with fewer words count as thin content, default 300 |
| `email.dkimSelectors` | List of DKIM selectors to look up. Without it DKIM is reported as not measured. |
| `weights` | Module weights, a number of 0 or more per module |
| `modules` | List of enabled modules |
| `outputs` | `card`, `social`, `pdf` and `fixPlan`, each true or false |

Unknown fields are rejected. A secret in the config file is rejected with a pointer to `PSI_API_KEY`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success, including `--help` and `--version` |
| 1 | Invalid input, invalid config or an unexpected error |
| 2 | The command is not implemented yet |

`cwa doctor` uses 0 for ready and 1 for not ready.
