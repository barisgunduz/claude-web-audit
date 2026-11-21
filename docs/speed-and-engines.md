# Speed measurement and engines

The speed module measures with Lighthouse. Lighthouse can run in two places, and this tool supports both.

| Engine | Where it runs | What it needs |
| --- | --- | --- |
| `psi` | Google's PageSpeed Insights API v5 | Network access. An API key is optional. |
| `lighthouse` | On your machine, with the Lighthouse library | Google Chrome installed on the machine |

## Choosing an engine (`--engine`)

| Value | Behavior |
| --- | --- |
| `auto` (default) | With `PSI_API_KEY` set, PSI is used first. If PSI fails (quota, network, server error), the tool falls back to local Lighthouse and records the fallback and its reason. Without a key, local Lighthouse is used. |
| `psi` | PSI only. It never falls back silently. If PSI fails, the module is partial or not measured, with the reason. |
| `lighthouse` | Local Lighthouse only. If no usable Chrome is found, the module is not measured, with a reason that points to `cwa doctor`. |

In `auto` mode, a quota or server error from PSI turns PSI off for the rest of the audit, so the following pages go straight to local Lighthouse. The fallback is stored per page in `audit.json`, and the terminal summary says how many measurements fell back.

## PageSpeed Insights

The tool calls `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed` with the page URL, the strategy (`mobile` or `desktop`) and the categories performance, accessibility, best-practices and seo.

- **API key.** The key is optional and is read only from the `PSI_API_KEY` environment variable. It is never a parameter and never goes into a config file. The PSI documentation describes one way to send the key, the `key` query parameter, and does not document a request header. So the key is sent in the URL, and for that reason the URL is never logged, never put in an error message and never stored. Every message that could contain the key is redacted, and `audit.json` holds the page URL, not the request URL. Tests check this with a sentinel key value, including on failure paths.
- **Quota.** The PSI documentation does not state quota numbers, and neither does this tool. During testing on 2026-11-21, a request without a key was refused with HTTP 429 (`RESOURCE_EXHAUSTED`, a daily limit). That is an observation, not a documented rule. If you want to use PSI regularly, create your own key in Google Cloud.
- **Retries.** A 429 or a 5xx response is retried up to three times, with a wait of 2, 4 and 8 seconds. A `Retry-After` header of up to 60 seconds is honored. A 429 that names a daily limit is not retried, because it will not clear within the wait. Every request has a time limit of 120 seconds. Requests run one after another, never in parallel.
- **Several categories.** The documentation does not say how several categories are passed in one request. The tool repeats the `category` parameter. This could not be confirmed against a successful live response, because the keyless quota refused the test request. If PSI answers with HTTP 400 for this, please open an issue.
- **Field data.** If the response has `loadingExperience` (real-user data), it is stored as an optional fact. It is not scored and nothing depends on it. Google's documentation says that it plans to stop including this data in the API and recommends the CrUX API.

## Local Lighthouse

The tool uses the Lighthouse library with the Chrome that is installed on your machine. It does not download a browser.

- **Finding Chrome.** In this order: the `chromePath` config field, the `CHROME_PATH` environment variable, then the common install locations of your operating system. `cwa doctor` shows which one it found.
- **Presets.** Mobile uses Lighthouse's default configuration: phone emulation with simulated throttling. In the Lighthouse version that was tested (13.6.0) this is a round trip time of 150 ms, a throughput of 1638.4 Kbps and a 4x CPU slowdown. Desktop uses the desktop preset that ships with Lighthouse. The tool sets no custom throttling.
- **Clean runs.** Every run starts a new headless Chrome with a new temporary profile, and closes it afterwards, also on failure and on Ctrl+C. The profile folder is deleted. `--no-sandbox` is added only when the tool runs as root inside a container. Nothing is saved to disk: no traces, no screenshots.
- **Limits.** A run that takes more than five minutes is stopped.

## Why numbers differ

Lighthouse scores are not exact. Expect differences between engines and between runs of the same engine.

- PSI runs on Google's servers, with their network and hardware. A local run uses your machine, your network location and your installed Chrome. Both use simulated throttling, but the result still depends on how fast the machine is and how busy it is.
- The Chrome and Lighthouse versions can differ. The tool stores the Lighthouse version of every measurement.
- A page can change between runs (ads, A/B tests, caches, server load).
- A cold server, or a CDN that has not cached the page yet, makes the first run slower.

For these reasons the tool runs each page more than once (see below), and the report states the method.

## Runs and the median (`--runs`)

Each page and strategy is measured `--runs` times (default 3), one after another. The tool then takes the run whose **performance score is the median** (with an even number of runs, the lower middle one) and reports **all metrics from that one run**, so the numbers stay consistent with each other. Mixing the medians of single metrics from different runs could give a combination that never happened.

The performance score of every run, with the minimum, maximum and spread, is stored in the facts. If a run fails after at least one run worked, the tool keeps the runs that worked and records how many failed.

## Which pages

The home page plus the most linked internal pages of the crawl. The number comes from the `speedPages` config field (default 3, maximum 10). `--strategy` (default `both`) chooses mobile, desktop or both.

## Time estimate

Before the first measurement the tool prints one line to the terminal, for example:

```
Speed: 18 Lighthouse runs (3 pages x 2 strategies x 3 runs), roughly 5 minutes to 18 minutes.
```

The range uses planning values of 15 to 60 seconds per local run and 10 to 60 seconds per PSI run. These are rough values and not measurements or official numbers. A local run of a very small page took about 18 seconds in testing. Heavy pages take longer. Use `--runs 1` or a lower `speedPages` for a faster check.

## How the numbers are rated

Metric limits are in `src/modules/speed/metric-thresholds.json`, with the source of every value. They are the control points of the Lighthouse metric audits (p10 is the good limit, the median is the poor limit), which differ for mobile and desktop. For LCP, FCP and CLS on mobile they match the values in the web.dev documentation. A mobile performance score below 50 is critical.

## Direct header checks

Compression and caching are checked from response headers, without a browser: for the HTML document of each measured page and up to 30 same-site static assets that these pages refer to. The Lighthouse audits for text compression and long cache lifetimes are skipped on purpose, so nothing is counted twice. See [checks.md](checks.md).

## Accessibility

The Lighthouse accessibility score is stored as a fact. The findings come from axe-core, which runs in the installed Chrome on up to `a11yPages` pages (default 10, maximum 50). The home page and the most linked pages are tested first. The tool waits for the page `load` event and one more second before it runs axe. Findings are grouped by axe rule. The axe impact decides the severity: critical and serious are important, moderate and minor are an improvement, and this module never reports critical. Browser requests to private addresses are blocked in these runs.

## The method statement

The report prints a statement like this, built from the stored facts:

> Measured with lighthouse (Lighthouse 13.6.0), mobile and desktop, 3 run(s) per page with the median run reported, throttling: simulate: RTT 150 ms, throughput 1638.4 Kbps, CPU slowdown 4x.

If a fallback happened, it adds how many measurements fell back from PageSpeed Insights to local Lighthouse. The same information is in `audit.json` under `method`, together with the timestamp of every measurement.

## Checking your setup

```
cwa doctor
```

It checks the Node version, Chrome, the installed Lighthouse and axe-core versions, whether `PSI_API_KEY` is set (it never prints any part of the value), whether the PSI endpoint can be reached, and general network access. It names the fix for every problem, and exits with 0 when everything that the chosen engine needs is available.
