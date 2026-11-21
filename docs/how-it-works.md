# How it works

This page describes the planned pipeline, from a domain name to the output files. Only the command line parsing exists today.

## 1. Normalize the domain

You pass `domain.com` or a full URL. The tool turns it into one canonical start URL and a host name. The crawler stays on that host.

## 2. Load settings

Settings come from three places. The command line wins over `cwa.config.json`, and the config file wins over the built-in defaults. The settings are validated before anything else runs, so a typo fails early with a clear message.

## 3. Crawl

The crawler starts at the home page, reads robots.txt and the sitemap, and follows internal links up to `--pages` pages. It waits `--delay` milliseconds between requests. External links are only checked for their status code.

## 4. Run modules

Nine modules read the crawl result and run their own checks: links, ssl, headers, seo, content, speed, a11y, email and ai. See [modules.md](modules.md) for what each one checks. A module that fails or cannot reach its data becomes "not measured". It never fails the whole audit.

## 5. Score

Each module scores 0 to 100. The total is a weighted average of the modules that were measured. Weights of modules that were not measured are removed and the rest are renormalized. The report says so.

Every finding has an id, a module, a severity (critical, important or improvement) and evidence URLs.

## 6. Write outputs

All outputs come from one file, `audit.json`. The PDF report, the summary card and the social images read from it, so they cannot disagree with each other. `FIX_PLAN.md` is built from the same findings.

## 7. Print a summary

The chat summary is at most 10 lines: the total score, the top 5 findings and the file paths.

## 8. Fix and verify

Claude works through `FIX_PLAN.md` from top to bottom. After each task, `/cwa verify <task-id>` re-measures the acceptance criteria. When every task is done, `/cwa recheck` runs the audit again and compares it with the previous one.
