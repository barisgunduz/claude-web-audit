# How it works

This page describes the pipeline from a domain name to the output files. The crawler, all nine modules and `audit.json` work today. Scoring, the report, the card, the social images and `FIX_PLAN.md` come in later steps.

## 1. Normalize the domain

You pass `domain.com` or a full URL. The tool turns it into one canonical start URL and a host name. The crawler stays on that host.

## 2. Load settings

Settings come from three places. The command line wins over `cwa.config.json`, and the config file wins over the built-in defaults. The settings are validated before anything else runs, so a typo fails early with a clear message.

## 3. Crawl

The crawler tests the four host variants (http and https, with and without www) and records every redirect hop. The final address of the https variant decides the canonical host.

It then reads robots.txt and the sitemaps (plain and gzip, including sitemap indexes). The home page is fetched first, then the sitemap URLs, then internal links in breadth first order. Paths that robots.txt blocks are not fetched. The crawler stops at exactly `--pages` pages, waits `--delay` milliseconds between requests to a host, runs at most `concurrency` requests at once, and gives each request 15 seconds.

External links are checked for their status code only, up to 200 unique URLs. The crawler also requests one page that does not exist, to see how the site answers, and reads `/llms.txt`.

## 4. Run modules

Nine modules read the crawl result and run their own checks (speed and a11y also use a browser, see [speed-and-engines.md](speed-and-engines.md)): links, ssl, headers, seo, content, speed, a11y, email and ai. See [modules.md](modules.md) for what each one checks. A module that fails or cannot reach its data becomes "not measured". It never fails the whole audit.

## 5. Score

Each module scores 0 to 100. The total is a weighted average of the modules that were measured. Weights of modules that were not measured are removed and the rest are renormalized. The report says so.

Every finding has an id, a module, a severity (critical, important or improvement) and evidence URLs.

## 6. Write outputs

All outputs come from one file, `audit.json`. The PDF report, the summary card and the social images read from it, so they cannot disagree with each other. `FIX_PLAN.md` is built from the same findings.

## 7. Print a summary

The chat summary is at most 10 lines: the total score, the top 5 findings and the file paths.

## 8. Fix and verify

Claude works through `FIX_PLAN.md` from top to bottom. After each task, `/cwa verify <task-id>` re-measures the acceptance criteria. When every task is done, `/cwa recheck` runs the audit again and compares it with the previous one.
