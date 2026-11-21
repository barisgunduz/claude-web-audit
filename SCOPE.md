# Scope

This document locks the scope of claude-web-audit. Every later step follows it. Decisions are final unless marked "to confirm in step 2".

## 1. Purpose

claude-web-audit is a command for Claude Code that audits a website end to end and produces three things:

- A human report (PDF and a one-screen summary card).
- A machine-readable result (`audit.json`).
- An ordered fix plan (`FIX_PLAN.md`) that Claude follows task by task, without skipping, until the whole renewal is done.

The repo is public, English only and global. It is for the author's own use and for anyone who wants it.

## 2. Identity

- Repo name: `claude-web-audit` (github.com/barisgunduz/claude-web-audit)
- Command: `/cwa`. The fallback name is `/cwebaudit` if `/cwa` conflicts with a built-in or another command. This is tested in step 9.
- Hub alias: `/gmwebrapor` lives in the author's own hub, not in this repo. It runs `/cwa` with `--by "Gündüz Medya" --lang tr`.
- License: MIT, copyright holder Barış Gündüz.
- README top line: "An independent community project built to work with Claude."

## 3. Principles

- English repo and docs. Other languages live only in `translations/` (Turkish first).
- The tool measures what can be measured. Anything that cannot be measured is shown as "not measured" and never as a zero score.
- Social media scoring is out of scope. The scope is the website itself.
- No client data in the repo. Demo data uses barisgunduz.com only. Aksay data never enters the repo.
- The report always states the measurement method and tool versions.
- Users should audit their own sites and sites they have permission to audit. The README says this.

## 4. Command and parameters

Basic use:

    /cwa domain.com

Flow: normalize the domain, crawl, run modules, score, write outputs, print a summary of at most 10 lines in chat (total score, top 5 findings, file paths).

Output folder: `audits/<domain>/<date>/`

### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `<domain>` | required | `domain.com` or a full URL |
| `--lang` | `en` | Language of report, card and social slides |
| `--by "Name"` | empty | "Prepared by" name on the cover and footer. If empty the line is omitted. One free-text name, no logo in the first release. |
| `--pages N` | `150` | Maximum pages to crawl |
| `--only a,b` | all | Run only these modules |
| `--skip a,b` | none | Skip these modules |
| `--engine` | `auto` | `psi`, `lighthouse` or `auto` (`psi` if `PSI_API_KEY` is set, else local Lighthouse) |
| `--strategy` | `both` | `mobile`, `desktop` or `both` |
| `--runs N` | `3` | Speed measurement repeats, the median is used |
| `--compare` | `last` | Compare with the previous audit. `none` turns it off. A folder path is also accepted. |
| `--card` / `--no-card` | `card` | One-screen summary card |
| `--social` | off | Three 4:5 social images |
| `--no-pdf` | off | Write only JSON and `FIX_PLAN.md` |
| `--no-fix-plan` | off | Skip `FIX_PLAN.md` |
| `--out dir` | `./audits` | Output folder |
| `--config file` | `cwa.config.json` | Config file |
| `--delay ms` | `250` | Wait between requests |
| `--fail-under N` | none | Exit with an error code if the total score is below N (for CI) |
| `--verbose` | off | Detailed logs |

The PageSpeed API key is never a parameter. It is read only from the `PSI_API_KEY` environment variable and is never written to the repo, the report, the logs or any output file.

### Subcommands

| Subcommand | What it does |
| --- | --- |
| `/cwa init` | Creates the config file by asking for domain, prepared-by name, language and page limit |
| `/cwa doctor` | Checks the environment (Chrome, Lighthouse, API key present, network) and names what is missing |
| `/cwa fix [audit]` | Makes Claude work through `FIX_PLAN.md` |
| `/cwa verify <task-id>` | Re-measures the acceptance criteria of one task |
| `/cwa recheck` | Re-runs the audit with the same settings and compares with the previous one (shortcut for `--compare last`) |
| `/cwa compare <a> <b>` | Compares two stored audits |
| `/cwa list` | Lists stored audits for a domain |

## 5. Modules

| Module | What it checks |
| --- | --- |
| `links` | Status of internal and external links, redirect chains and loops, orphan pages, correct status code on the 404 page, "#" and empty links, generic link text |
| `ssl` | Certificate validity, expiry date, chain, protocol version, HTTP to HTTPS 301, one canonical host (www or non-www), mixed content |
| `headers` | HSTS, CSP, X-Content-Type-Options, frame protection, Referrer-Policy, Permissions-Policy, server and version information leaks |
| `seo` | Title, description, canonical, robots meta, H1 to H3 hierarchy, hreflang, Open Graph and Twitter card, JSON-LD validation, sitemap and robots.txt, favicon, viewport, lang, image alt text and dimensions |
| `content` | Duplicate or near-duplicate titles and descriptions, thin content, heading depth, internal link distribution, click depth |
| `speed` | Lighthouse for mobile and desktop (LCP, FCP, TBT, CLS, Speed Index), opportunities, gzip and brotli, cache headers, image formats, page weight |
| `a11y` | PageSpeed accessibility plus axe-core rules page by page (contrast, form labels, landmarks, touch targets) |
| `email` | SPF, DMARC and its policy, MX presence. DKIM only when the selector is known. |
| `ai` | llms.txt, status of AI bots in robots.txt (GPTBot, ClaudeBot, PerplexityBot, Google-Extended), Content-Signal, content readable without JavaScript, sameAs and entity data |

Not measured. These are reported as "not measured", and each one becomes a task that needs user input in `FIX_PLAN.md`:

- Google Business Profile
- Search Console data
- Real rankings
- Backlinks
- Brand tests in AI chat assistants

## 6. Scoring

- Each module scores 0 to 100. The total is a weighted average.
- Default weights (configurable):

| Module | Weight |
| --- | --- |
| `speed` | 20 |
| `seo` | 20 |
| `links` | 10 |
| `ssl` | 10 |
| `a11y` | 10 |
| `headers` | 8 |
| `content` | 8 |
| `ai` | 8 |
| `email` | 6 |
| Total | 100 |

- A module that is not measured is excluded and the remaining weights are renormalized. The report says so.
- Every finding has an id, module, severity (critical, important, improvement) and evidence URLs.
- A failing or unreachable module never fails the whole audit. That module becomes "not measured".
- Speed uses the median of `--runs` measurements. The report states the engine (PSI or local Lighthouse) and its version.

## 7. Outputs

Folder layout under `audits/<domain>/<date>/`:

- `report.pdf`: cover, executive summary with score gauges, module scores, speed, findings by module, priorities, methodology and limits, not-measured list. With `--compare` it shows before and now columns.
- `summary-card.png` and `summary-card.pdf`: one screen, 1920x1080. Score gauges, mobile speed bars with target ticks, site health rows, three summary figures. With `--compare` it shows before and now. Without a previous audit it shows current values and found-issue counts instead of the "before" column. Items above target stay highlighted in the accent color. It reads from `audit.json` so it can never disagree with the report.
- `social-1.png` to `social-3.png`: only with `--social`. Three 4:5 images (1080x1350) in the same theme. Image 1 is the score hero, 2 is mobile speed, 3 is site health.
- `audit.json`: machine-readable result with modules, scores, findings, evidence, method and tool versions.
- `FIX_PLAN.md`: ordered tasks for Claude.

Report, card and social text come from language files. `FIX_PLAN.md` and `audit.json` are always English.

## 8. FIX_PLAN.md format

The file starts with rules for Claude:

- Work from top to bottom, one task at a time.
- Do not move to the next task before the acceptance criteria are verified with `/cwa verify`.
- Do not skip any task. If blocked, write the reason in the file and stop.
- Do not read or modify .env files, keys or secrets folders. Stay inside the open project folder.
- Keep the existing design and components. Do not change visible text without approval.
- Tasks that need user input are placed last and are asked about, not guessed.
- When all tasks are done, run `/cwa recheck` and report the comparison.

Each task has this shape: id (T-014), title, priority (P0 to P3), module, status checkbox, evidence URLs, why, numbered steps, acceptance criteria, verify command (`/cwa verify T-014`), needs-user-input flag.

Example:

    ### T-014 Add a meta description to the services page

    - Status: [ ] open
    - Priority: P1
    - Module: seo
    - Needs user input: no
    - Evidence:
      - https://example.com/services

    Why: The page has no meta description. Search engines will pick a snippet
    from the page text, which often reads poorly in results.

    Steps:
    1. Open the template that renders https://example.com/services.
    2. Add a meta description of 120 to 160 characters that describes the page.
    3. Keep the existing title and visible text unchanged.

    Acceptance criteria:
    - The page returns exactly one meta description.
    - The description is between 120 and 160 characters.

    Verify: /cwa verify T-014

Ordering is by priority. Tasks that touch the same file are grouped together.

## 9. Config file

File name: `cwa.config.json`.

Fields: `domain`, `pages`, `prepared_by` (optional), `report_language` (default `en`), `engine`, `strategy`, `runs`, `delay`, `weights`, `modules` (enabled list), `outputs` (`card`, `social`, `pdf`, `fixPlan`).

Command-line parameters override config values.

## 10. Report language

English is the default. Other languages are chosen with `--lang` or `report_language`.

All fixed texts (headings, status labels, table columns, finding descriptions, "not measured") live in one language file per language (`en`, `tr`). A missing key falls back to English. Source-site content (titles, descriptions, URLs) is never translated.

Community language files are welcome and the README explains how to add one. The author provides the `tr` file.

## 11. Theme and branding

- The default theme is the light corporate report design.
- Palette: ink `#1c2128`, accent `#e4501e`, ok `#2e7d5b`, warn `#b9770e`, tint `#f6f5f2`.
- Font: Inter.
- No brand name is hardcoded in code or templates. The only brand text is the optional `prepared_by` value. Empty means the line is omitted.

## 12. Secrets and safety

- API keys only from environment variables. Never stored in the repo, config, report, logs or outputs.
- The crawler obeys robots.txt, uses a polite request rate and stays on the given domain. External links are only checked for status codes.
- Never read, print or modify .env files or private keys.

## 13. Runtime (to confirm in step 2)

Proposed: Node.js on the latest active LTS, Lighthouse as a dependency, headless Chrome for PDF and PNG output, no other heavy runtime. Step 2 confirms or changes this before any code is written.

## 14. Docs and demo

- Root docs in English: `README.md`, `SCOPE.md`, `CONTRIBUTING.md`, and `docs/` for how-it-works and examples.
- `translations/` holds README equivalents per language (Turkish first), with how-it-works guidance, examples and small screenshots.
- The demo audit uses barisgunduz.com.
- README screenshots are cropped from the generated English report and card (gauges, speed table, target distance bars, comparison table), never from the site itself.
- The before and now images come from two real measurements.

## 15. Roadmap

1. Lock scope and architecture (this document)
2. Repo skeleton and English doc structure
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
