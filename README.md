# claude-web-audit

Open-source website audit for Claude Code. Crawls a site, scores SEO, speed, SSL, links, accessibility and AI visibility, then writes a report and an ordered fix plan Claude can follow.

An independent community project built to work with Claude.

claude-web-audit audits a website end to end. It crawls the site, runs nine modules, scores each one from 0 to 100 and writes a PDF report, a one-screen summary card, a machine-readable `audit.json` and a `FIX_PLAN.md`. Claude works through the fix plan task by task, and re-measures each task before it moves on.

## Status

Under construction. The tool does not audit anything yet. The command line parses and validates its input, then exits with code 2 and says that the command is not implemented. The full plan is in [SCOPE.md](SCOPE.md).

Roadmap:

1. Lock scope and architecture (done)
2. Repo skeleton and English doc structure (in progress)
3. Crawler and checks
4. PageSpeed integration with local Lighthouse fallback
5. Scoring and findings model
6. FIX_PLAN.md generator and Claude instructions
7. PDF report template, card and social slides (themeable)
8. Re-audit and compare mode
9. Commands, skill and hub layer
10. Demo report and screenshots
11. Translations folder (Turkish first)
12. Local validation
13. Open-source cleanup and release

## Planned usage

```
/cwa domain.com
```

The main parameters:

| Parameter | Default | What it does |
| --- | --- | --- |
| `--lang` | `en` | Language of the report, card and social slides |
| `--by "Name"` | empty | "Prepared by" name on the cover and footer |
| `--pages N` | `150` | Maximum pages to crawl |
| `--only a,b` / `--skip a,b` | all / none | Run or skip modules |
| `--engine` | `auto` | `psi`, `lighthouse` or `auto` |
| `--compare last` | none | Compare with the previous audit |
| `--social` | off | Write three 4:5 social images |

Other commands: `/cwa init`, `/cwa doctor`, `/cwa fix`, `/cwa verify <task-id>`, `/cwa recheck`, `/cwa compare <a> <b>` and `/cwa list`. The full reference is in [docs/parameters.md](docs/parameters.md).

## Outputs

Each audit writes to `audits/<domain>/<date>/`:

- `report.pdf`, the full report
- `summary-card.png` and `summary-card.pdf`, a one-screen summary
- `social-1.png` to `social-3.png`, only with `--social`
- `audit.json`, the machine-readable result
- `FIX_PLAN.md`, ordered tasks for Claude

## Requirements

- Node.js 26 (the active LTS). An `.nvmrc` file is included.
- Google Chrome or Chromium, for Lighthouse and for PDF and PNG output.
- Optional: a PageSpeed Insights API key in the `PSI_API_KEY` environment variable. Without it, the tool uses local Lighthouse. The key is only read from the environment and is never written to a file, a report or a log.

## Languages

English is the default. Other languages live in language files, and translated READMEs live in [translations/](translations/). Turkish comes first.

## Responsible use

Audit your own sites and sites you have permission to audit. The crawler obeys robots.txt and waits between requests, but a permission to audit is still your responsibility.

## Documentation

- [SCOPE.md](SCOPE.md), the decisions this project follows
- [docs/how-it-works.md](docs/how-it-works.md)
- [docs/parameters.md](docs/parameters.md)
- [docs/modules.md](docs/modules.md)
- [docs/fix-plan.md](docs/fix-plan.md)
- [docs/architecture.md](docs/architecture.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Barış Gündüz.
