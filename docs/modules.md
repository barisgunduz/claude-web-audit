# Modules

Each module scores 0 to 100. Default weights are in the last column and can be changed in the config file.

| Module | What it checks | Weight |
| --- | --- | --- |
| `links` | Status of internal and external links, redirect chains and loops, orphan pages, correct status code on the 404 page, "#" and empty links, generic link text | 10 |
| `ssl` | Certificate validity, expiry date, chain, protocol version, HTTP to HTTPS 301, one canonical host (www or non-www), mixed content | 10 |
| `headers` | HSTS, CSP, X-Content-Type-Options, frame protection, Referrer-Policy, Permissions-Policy, server and version information leaks | 8 |
| `seo` | Title, description, canonical, robots meta, H1 to H3 hierarchy, hreflang, Open Graph and Twitter card, JSON-LD validation, sitemap and robots.txt, favicon, viewport, lang, image alt text and dimensions | 20 |
| `content` | Duplicate or near-duplicate titles and descriptions, thin content, heading depth, internal link distribution, click depth | 8 |
| `speed` | Lighthouse for mobile and desktop (LCP, FCP, TBT, CLS, Speed Index), opportunities, gzip and brotli, cache headers, image formats, page weight | 20 |
| `a11y` | PageSpeed accessibility plus axe-core rules page by page (contrast, form labels, landmarks, touch targets) | 10 |
| `email` | SPF, DMARC and its policy, MX presence. DKIM only when the selector is known. | 6 |
| `ai` | llms.txt, status of AI bots in robots.txt (GPTBot, ClaudeBot, PerplexityBot, Google-Extended), Content-Signal, content readable without JavaScript, sameAs and entity data | 8 |

## Status in this version

| Module | Checks | Finding codes | State |
| --- | --- | --- | --- |
| `links` | 9 | 18 | implemented |
| `ssl` | 5 | 14 | implemented |
| `headers` | 3 | 12 | implemented |
| `seo` | 9 | 47 | implemented |
| `content` | 5 | 7 | implemented |
| `email` | 4 | 12 | implemented, DKIM needs selectors |
| `ai` | 4 | 10 | implemented |
| `speed` | 0 | 0 | not measured, "implemented in step 4" |
| `a11y` | 0 | 0 | not measured, "implemented in step 4" |

Every code is listed with its severity and fix in [checks.md](checks.md). The crawler reads static HTML only and runs no JavaScript.

## How to read the results

- A page can be affected by a limit. When the page limit is reached, the checks that depend on inbound links (orphan pages and link distribution) report "not measured" and say why.
- The email module checks the host name without `www`. For a site on a subdomain, SPF, DMARC and MX records often live on the parent domain, so these findings can be false positives there.
- "Content readable without JavaScript" is a heuristic with low confidence. It compares the static text with script and root element signs.
- Statuses 401, 403, 429 and 999 on external links are not reported as broken, because sites often return them to automated clients.
- AI bot names and purposes come from each vendor's own documentation, with the source URL next to each entry in `src/modules/ai/bots.ts`. The Content-Signal syntax follows the Cloudflare announcement of 2025-09-24, because the formal specification page could not be read. Unrecognized signal names are reported as unrecognized, not as errors in the file.
- Blocked AI training bots are listed in the facts, and not reported as findings. Blocked search and user-triggered bots are reported as an improvement.

## Not measured

The tool measures what can be measured. These items cannot be measured from the outside, so they are shown as "not measured" and never as a zero score:

- Google Business Profile
- Search Console data
- Real rankings
- Backlinks
- Brand tests in AI chat assistants

Each of them becomes a task in `FIX_PLAN.md` that needs user input. Social media scoring is out of scope.

A module can also be "not measured" when it fails, for example when the site is unreachable for Lighthouse. Its weight is then removed and the other weights are renormalized. The report says which modules were left out.
