# Checks

Every finding has a stable code. The English message for each code is in `src/i18n/en.json` under `finding.<code>`. A test fails when a code has no message or no entry in this file.

## Severity

- **critical**: the site is broken or exposed. Examples: not served over HTTPS, an expired certificate, noindex on the home page, robots.txt blocking everything, a server error on the home page.
- **important**: a clear SEO, security or reliability risk.
- **improvement**: polish.

Evidence lists are cut to the first 10 items. The `count` field of a finding holds the real total.

## Who owns what

Some topics could be reported twice. Each one has one owner, so the same issue is never counted twice.

| Topic | Owner | Notes |
| --- | --- | --- |
| Duplicate titles and descriptions | content (CNT-001, CNT-002) | The seo module reports missing, short and long titles and descriptions only. |
| Pages without inbound links | links (LINK-009) | Pages in a sitemap with no inbound link. content (CNT-007) reports pages with one inbound link, and pages with none that are not in a sitemap. |
| HSTS | headers (HDR-001, HDR-002) | The ssl module does not check it. |
| Compression and cache headers | speed (SPD-050 to SPD-054) | Not checked in the headers module. The Lighthouse audits for text compression and long cache lifetimes are skipped. |
| Redirect chains | links (LINK-005, LINK-006) | SPD-038 only says that the main document redirects in a Lighthouse run. |
| Image formats and page weight | speed (SPD-025, SPD-040) | Read from the Lighthouse result. The links module does not check them. |
| Missing image alt text and size attributes | seo (SEO-027, SEO-028) | The a11y module reports the axe rules, which can include the same images. |
| Structured data validity | seo (SEO-021 to SEO-023, SEO-047) | The ai module only reads Organization data for the entity check. |

## links

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| LINK-001 | important | {count} internal URLs return a 4xx client error. | Fix the link, or restore or redirect the missing page. |
| LINK-002 | important (critical on the home page) | {count} internal URLs return a 5xx server error. | Fix the server error. The home page returning 5xx is critical. |
| LINK-003 | important (critical on the home page) | {count} internal URLs did not respond (timeout or connection error). | Check server capacity and the URL. The home page not responding is critical. |
| LINK-004 | important | {count} external links are broken. | Update or remove the links. Statuses 401, 403, 429 and 999 are not reported because they are usually bot blocks. |
| LINK-005 | important | {count} URLs go through more than 3 redirects. | Point the old address straight at the final address. |
| LINK-006 | important | {count} URLs end in a redirect loop. | Fix the redirect rules so the chain ends on a page. |
| LINK-007 | improvement | {count} internal links point to a URL that redirects. | Update the links to the final address. |
| LINK-008 | important | {count} internal links use a non-canonical address (http or another host variant). | Link to the canonical https address. |
| LINK-009 | important | {count} pages in the sitemap have no inbound link from other crawled pages. | Link to these pages from related pages or remove them from the sitemap. Not reported when the page limit was reached. |
| LINK-010 | important | The server answers a non-existent page with a success status or a redirect (soft 404). | Return status 404 for pages that do not exist. |
| LINK-011 | important | The server answers a non-existent page with a server error. | Return status 404 for pages that do not exist. |
| LINK-012 | improvement | {count} links have an empty href. | Remove the link or set a real destination. |
| LINK-013 | improvement | {count} links use "#" as href. | Use a real destination or a button element. |
| LINK-014 | improvement | {count} links use a javascript: href. | Use a real URL, and enhance it with script if needed. |
| LINK-015 | improvement | {count} mailto links are invalid. | Use mailto:name@example.com. |
| LINK-016 | improvement | {count} tel links are invalid. | Use tel:+ followed by the number. |
| LINK-017 | improvement | {count} links use generic anchor text such as "click here" or "read more". | Describe the destination in the link text. |
| LINK-018 | improvement | {count} linked pages are blocked by robots.txt and were not crawled. | Allow the pages in robots.txt or remove the links. |

## ssl

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| SSL-001 | critical | The site is not served over HTTPS. | Install a certificate and redirect all traffic to https. |
| SSL-002 | critical | The TLS connection to the host failed ({reason}). | Check that port 443 is open and the certificate is installed. |
| SSL-003 | critical | The certificate expired on {validTo}. | Renew the certificate now and automate renewal. |
| SSL-004 | critical | The certificate expires in {days} days. | Renew the certificate and automate renewal. |
| SSL-005 | important | The certificate expires in {days} days. | Renew the certificate and automate renewal. |
| SSL-006 | critical | The certificate does not cover the host {host}. | Issue a certificate that lists the host in its subject alternative names. |
| SSL-007 | important (critical when self-signed) | The certificate chain is not trusted ({reason}). | Install the intermediate certificates, or use a certificate from a trusted authority. |
| SSL-008 | important | The server negotiated {protocol}, which is outdated. | Disable TLS 1.0 and 1.1 and enable TLS 1.2 and 1.3. |
| SSL-009 | important | The redirect from http to https is not permanent (301 or 308 expected). | Use a 301 or 308 redirect. |
| SSL-010 | important | http addresses are served without a redirect to https. | Redirect every http address to https. |
| SSL-011 | important | The four host variants (http and https, with and without www) do not end on one address. | Redirect all variants to one canonical address. |
| SSL-012 | important | Redirects between host variants are temporary instead of permanent. | Use 301 or 308 redirects between host variants. |
| SSL-013 | important | {count} active resources (scripts, styles, frames, forms) load over http on https pages. | Load them over https. Browsers block these. |
| SSL-014 | improvement | {count} passive resources (images, media) load over http on https pages. | Load them over https. |

## headers

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| HDR-001 | important | Strict-Transport-Security is missing on {count} sampled pages. | Send Strict-Transport-Security with a max-age of at least 15552000. |
| HDR-002 | improvement | The Strict-Transport-Security max-age is below 6 months on {count} sampled pages. | Raise max-age to at least 15552000 seconds. |
| HDR-003 | important | Content-Security-Policy is missing on {count} sampled pages. | Add a Content-Security-Policy header, starting in report-only mode if needed. |
| HDR-004 | important | X-Content-Type-Options: nosniff is missing on {count} sampled pages. | Send X-Content-Type-Options: nosniff. |
| HDR-005 | important | Frame protection (X-Frame-Options or CSP frame-ancestors) is missing on {count} sampled pages. | Send frame-ancestors in the CSP, or X-Frame-Options. |
| HDR-006 | improvement | Referrer-Policy is missing on {count} sampled pages. | Send a Referrer-Policy such as strict-origin-when-cross-origin. |
| HDR-007 | improvement | Permissions-Policy is missing on {count} sampled pages. | Send a Permissions-Policy that turns off features the site does not use. |
| HDR-008 | improvement | The Server header reveals a version on {count} sampled pages. | Remove the version from the Server header. |
| HDR-009 | improvement | The X-Powered-By header is set on {count} sampled pages. | Remove the X-Powered-By header. |
| HDR-010 | important | {count} cookies are set without the Secure flag. | Add the Secure flag. |
| HDR-011 | improvement | {count} cookies are set without the HttpOnly flag. | Add HttpOnly to cookies that scripts do not need. |
| HDR-012 | improvement | {count} cookies are set without the SameSite attribute. | Add SameSite=Lax or SameSite=Strict. |

## seo

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| SEO-001 | important | {count} pages have no title. | Add a unique title to each page. |
| SEO-002 | improvement | {count} pages have a title shorter than 30 characters. | Describe the page in 30 to 60 characters. |
| SEO-003 | improvement | {count} pages have a title longer than 60 characters. | Shorten the title to 60 characters or less. |
| SEO-004 | important | {count} pages have no meta description. | Add a meta description of 70 to 160 characters. |
| SEO-005 | improvement | {count} pages have a meta description shorter than 70 characters. | Write 70 to 160 characters. |
| SEO-006 | improvement | {count} pages have a meta description longer than 160 characters. | Shorten it to 160 characters or less. |
| SEO-007 | important | {count} indexable pages have no canonical link. | Add a self-referencing canonical link. |
| SEO-008 | improvement | {count} pages use a relative canonical URL. | Use an absolute URL. |
| SEO-009 | improvement | {count} pages point their canonical to a different URL. | Check that the canonical is intended. Otherwise make it self-referencing. |
| SEO-010 | important | {count} pages have a canonical that does not return 200 or that redirects. | Point the canonical at the final, indexable address. |
| SEO-011 | critical | The home page is set to noindex. | Remove noindex from the meta robots tag and the X-Robots-Tag header. |
| SEO-012 | improvement | {count} pages are set to noindex. | Check that this is intended. |
| SEO-013 | important | {count} pages have no h1. | Add one h1 that names the page. |
| SEO-014 | improvement | {count} pages have more than one h1. | Keep one h1 per page. |
| SEO-015 | improvement | {count} pages skip heading levels. | Do not jump over levels, for example from h2 to h4. |
| SEO-016 | important | {count} hreflang values are not valid language codes. | Use codes such as en, en-GB or x-default. |
| SEO-017 | important | {count} hreflang alternates do not link back. | Add the return link on the alternate page. |
| SEO-018 | improvement | {count} pages have hreflang alternates but no x-default. | Add an x-default alternate. |
| SEO-019 | improvement | {count} pages miss Open Graph tags ({tags}). | Add og:title, og:description, og:image and og:url. |
| SEO-020 | improvement | {count} pages have no Twitter card tag. | Add twitter:card. |
| SEO-021 | important | {count} pages contain JSON-LD that is not valid JSON. | Fix the JSON syntax. |
| SEO-022 | important | {count} JSON-LD items miss @context or @type. | Add @context and @type. |
| SEO-023 | important | {count} structured data items miss required properties. | Add the properties listed in the evidence. Rules are in src/modules/seo/jsonld-rules.json. |
| SEO-024 | improvement | No favicon was found. | Add a favicon link, or serve /favicon.ico. |
| SEO-025 | important | {count} pages have no viewport meta tag. | Add <meta name="viewport" content="width=device-width, initial-scale=1">. |
| SEO-026 | improvement | {count} pages have no lang attribute on the html element. | Add lang to the html element. |
| SEO-027 | improvement | {count} images have no alt attribute. | Add alt text, or alt="" for decorative images. |
| SEO-028 | improvement | {count} images have no width and height. | Set width and height to avoid layout shift. |
| SEO-029 | improvement | {count} URLs contain uppercase letters. | Use lowercase URLs and redirect the old ones. |
| SEO-030 | improvement | {count} URLs contain underscores. | Use hyphens and redirect the old URLs. |
| SEO-031 | improvement | {count} URLs are longer than 115 characters. | Shorten the URLs. |
| SEO-032 | improvement | {count} URLs have more than 3 query parameters. | Reduce the parameters or use clean paths. |
| SEO-033 | important | No valid sitemap was found. | Publish a sitemap and list it in robots.txt. |
| SEO-034 | important | {count} sitemap files are not valid sitemap XML. | Fix the XML. The root element must be urlset or sitemapindex. |
| SEO-035 | important | {count} sitemap files exceed the limit of 50,000 URLs or 50 MB. | Split the sitemap and use a sitemap index. |
| SEO-036 | important | {count} sitemap URLs do not return 200. | Remove them from the sitemap or fix the pages. |
| SEO-037 | improvement | {count} sitemap URLs redirect. | List the final addresses. |
| SEO-038 | important | {count} sitemap URLs are set to noindex. | Remove them from the sitemap or remove noindex. |
| SEO-039 | important | {count} sitemap URLs are not the canonical version. | List only canonical URLs on the canonical host. |
| SEO-040 | improvement | {count} sitemap lastmod values are invalid. | Use W3C datetime, for example 2026-11-21. |
| SEO-041 | improvement | Most sitemap URLs have no lastmod. | Add accurate lastmod dates. |
| SEO-042 | improvement | {count} crawled indexable pages are missing from the sitemap. | Add them to the sitemap. |
| SEO-043 | improvement | robots.txt was not found. | Publish a robots.txt file. |
| SEO-044 | critical | robots.txt blocks the whole site for all crawlers. | Remove the blanket Disallow: / rule. |
| SEO-045 | improvement | robots.txt has no Sitemap line. | Add a Sitemap line with the sitemap URL. |
| SEO-046 | improvement | robots.txt has {count} syntax problems. | Fix the lines listed in the evidence. |
| SEO-047 | improvement | {count} structured data items miss recommended properties. | Add the recommended properties listed in the evidence. |

## content

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| CNT-001 | important | {groups} groups of pages share the same title ({pages} pages). | Give every page a unique title. This module owns duplicate titles. |
| CNT-002 | improvement | {groups} groups of pages share the same meta description ({pages} pages). | Give every page a unique description. This module owns duplicate descriptions. |
| CNT-003 | important | {count} page pairs have near-identical body text. | Merge the pages, rewrite one, or point a canonical at the main page. |
| CNT-004 | improvement | {count} pages have fewer than {minimum} words. | Expand the content or merge the page. Contact and legal pages are not flagged. |
| CNT-005 | improvement | {count} pages use heading levels h5 or h6. | Simplify the structure. |
| CNT-006 | improvement | {count} pages are more than {limit} clicks from the home page. | Link to them from higher-level pages. |
| CNT-007 | improvement | {count} pages have one or no inbound link. | Link to them from related pages. |

## email

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| EML-001 | important | No SPF record was found. | Publish an SPF record. |
| EML-002 | important | More than one SPF record was found. | Merge them into one record. |
| EML-003 | important | The SPF record has invalid terms. | Fix the terms listed in the evidence. |
| EML-004 | important | The SPF record needs more than {limit} DNS lookups (counted {lookups} before stopping). | Remove include terms or flatten the record. |
| EML-005 | important | The SPF record has a weak or missing "all" ({qualifier}). | End the record with ~all or -all. |
| EML-006 | important | No DMARC record was found. | Publish a DMARC record at _dmarc. |
| EML-007 | improvement | The DMARC policy is none, so no mail is rejected or quarantined. | Move to quarantine or reject after reviewing reports. |
| EML-008 | improvement | The DMARC record has no rua address for reports. | Add a rua mailbox. |
| EML-009 | improvement | The DMARC record applies to only {pct} percent of mail. | Raise pct to 100. |
| EML-010 | important | The DMARC record is invalid ({reason}). | Fix the record. It needs v=DMARC1 and a p tag. |
| EML-011 | improvement | No MX record was found. | Add MX records if the domain receives mail. Ignore this if it does not. |
| EML-012 | important | {count} DKIM selectors have no valid key. | Publish the DKIM key for each selector. |

## ai

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| AI-001 | improvement | No llms.txt was found. | Publish /llms.txt if you want to give AI tools a short guide to the site. |
| AI-002 | improvement | llms.txt is served as {contentType}, not text/plain or text/markdown. | Serve it as text/plain or text/markdown. |
| AI-003 | improvement | llms.txt is empty. | Add content. |
| AI-004 | improvement | llms.txt does not start with a Markdown title line. | Start with "# Site name". |
| AI-005 | improvement | {count} links in llms.txt do not resolve. | Fix or remove the links. |
| AI-006 | improvement | {count} AI search or user-triggered bots are blocked in robots.txt. | Allow them if you want to appear in AI answers. Blocked training bots are only listed in the facts. |
| AI-007 | improvement | {count} Content-Signal values are not recognized. | Use search, ai-input and ai-train with yes or no. |
| AI-008 | important | {count} pages have very little static text. They may rely on client-side rendering (low confidence). | Render the main content on the server or at build time. |
| AI-009 | improvement | No Organization or LocalBusiness data was found in the JSON-LD of the home page. | Add Organization JSON-LD. |
| AI-010 | improvement | The organization data misses properties. | Add name, url, logo, address and sameAs. |

## speed

Lighthouse results come from PageSpeed Insights or from local Lighthouse, see [speed-and-engines.md](speed-and-engines.md). Findings are grouped per code, and the evidence lines name the page and the strategy (mobile or desktop). The header checks (SPD-050 to SPD-054) need no browser.

Metric limits are in `src/modules/speed/metric-thresholds.json` with the source of each value. A value at or below the good limit is good, above the poor limit is poor, and in between needs improvement. The limits are the Lighthouse control points, which differ for mobile and desktop.

Lighthouse audits that become findings are listed in `src/modules/speed/audit-findings.json`. An audit that scored below 0.9 becomes important when its score is below 0.5, and an improvement otherwise. Lighthouse 13 replaced several older audits with "insight" audits. Two of them are not turned into findings, because the direct header checks own their topics:

- `cache-insight` (long cache lifetimes), owned by SPD-052 to SPD-054.
- The compression answer of `document-latency-insight` (text compression), owned by SPD-050 and SPD-051. Its redirect and server response answers are used (SPD-038 and SPD-039).

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| SPD-001 | critical (mobile below 50), important (desktop below 50), improvement (50 to 89) | {count} measurements have a Lighthouse performance score below 90 (lowest {lowest}). | Work through the findings below. Mobile below 50 is critical, desktop below 50 is important, 50 to 89 is an improvement. |
| SPD-002 | important when poor, improvement when it needs improvement | {metric} is poor on {poor} and needs improvement on {needsImprovement} measurements. | Check the LCP element and its request in the evidence. Values are rated with the Lighthouse control points of the form factor. |
| SPD-003 | important when poor, improvement when it needs improvement | {metric} is poor on {poor} and needs improvement on {needsImprovement} measurements. | Reduce render-blocking resources and server response time. |
| SPD-004 | important when poor, improvement when it needs improvement | {metric} is poor on {poor} and needs improvement on {needsImprovement} measurements. | Split long JavaScript tasks and remove unused scripts. |
| SPD-005 | important when poor, improvement when it needs improvement | {metric} is poor on {poor} and needs improvement on {needsImprovement} measurements. | Set width and height on images and embeds, and reserve space for late content. |
| SPD-006 | important when poor, improvement when it needs improvement | {metric} is poor on {poor} and needs improvement on {needsImprovement} measurements. | Make the visible part of the page render sooner. |
| SPD-020 | important when the audit score is below 0.5, else improvement | {count} measurements report render-blocking resources (estimated savings up to {savingsMs} ms). | Defer or inline the render-blocking CSS and JavaScript. |
| SPD-021 | important when the audit score is below 0.5, else improvement | {count} measurements report unused CSS (estimated savings up to {savingsKiB} KiB). | Remove CSS that the page does not use, or split it by page. |
| SPD-022 | important when the audit score is below 0.5, else improvement | {count} measurements report unused JavaScript (estimated savings up to {savingsKiB} KiB). | Remove or lazy load JavaScript that the page does not use. |
| SPD-023 | important when the audit score is below 0.5, else improvement | {count} measurements report CSS that is not minified (estimated savings up to {savingsKiB} KiB). | Minify the CSS in the build. |
| SPD-024 | important when the audit score is below 0.5, else improvement | {count} measurements report JavaScript that is not minified (estimated savings up to {savingsKiB} KiB). | Minify the JavaScript in the build. |
| SPD-025 | important when the audit score is below 0.5, else improvement | Image delivery can be improved on {count} measurements (formats, sizes or compression), estimated savings up to {savingsKiB} KiB. | Serve modern formats such as WebP or AVIF in the size that is shown. Image formats are reported here, from the Lighthouse result. |
| SPD-026 | important when the audit score is below 0.5, else improvement | The request for the Largest Contentful Paint element is found late or not prioritized on {count} measurements. | Put the LCP image in the HTML, and use fetchpriority="high" instead of loading it from script. |
| SPD-027 | important when the audit score is below 0.5, else improvement | Layout shifts were found on {count} measurements. | Reserve space for images, embeds and late content. |
| SPD-028 | improvement | Long main-thread tasks were found on {count} measurements while Total Blocking Time is not good. | Split the long tasks. Only reported when Total Blocking Time is rated needs improvement or poor. |
| SPD-029 | important when the audit score is below 0.5, else improvement | Third-party code slows down {count} measurements. | Remove, defer or lazy load third-party scripts. |
| SPD-030 | important when the audit score is below 0.5, else improvement | The DOM is large on {count} measurements. | Reduce the number of elements and the depth of the DOM. |
| SPD-031 | important when the audit score is below 0.5, else improvement | Legacy JavaScript (code for old browsers) is served on {count} measurements, estimated savings up to {savingsKiB} KiB. | Stop transpiling and polyfilling for features that modern browsers have. |
| SPD-032 | important when the audit score is below 0.5, else improvement | Duplicated JavaScript modules were found on {count} measurements, estimated savings up to {savingsKiB} KiB. | Remove duplicate copies of the same module from the bundles. |
| SPD-033 | important when the audit score is below 0.5, else improvement | Web fonts delay text rendering on {count} measurements. | Use font-display: swap, or preload the font. |
| SPD-034 | important when the audit score is below 0.5, else improvement | Requests use an old HTTP version on {count} measurements. | Serve the site over HTTP/2 or HTTP/3. |
| SPD-035 | important when the audit score is below 0.5, else improvement | Long chains of dependent requests delay rendering on {count} measurements. | Shorten the chains with preload or by inlining critical files. |
| SPD-036 | important when the audit score is below 0.5, else improvement | JavaScript execution time is high on {count} measurements. | Reduce and split the JavaScript that runs at load. |
| SPD-037 | important when the audit score is below 0.5, else improvement | Main-thread work is high on {count} measurements. | Reduce script, style and layout work during load. |
| SPD-038 | improvement | Redirects slow down the main document on {count} measurements. | Link to the final address. The redirect check in the links module reports the chains. |
| SPD-039 | important | The server answers slowly on {count} measurements. | Improve server response time with caching and a faster backend. |
| SPD-040 | important when the audit score is below 0.5, else improvement | The page is heavy on {count} measurements (largest {largestKiB} KiB). | Reduce the transfer size of images, scripts and fonts. Page weight comes from the Lighthouse result. |
| SPD-050 | important | The HTML of {count} sampled pages is not compressed (gzip or Brotli). | Enable gzip or Brotli for HTML. Documents under 1 KiB are skipped. Compression is checked from response headers, so the Lighthouse compression audit is skipped. |
| SPD-051 | improvement | {count} text assets are not compressed (gzip or Brotli). | Enable gzip or Brotli for CSS, JavaScript, SVG, JSON and fonts in TTF or OTF. Images and WOFF files are already compressed and are skipped. |
| SPD-052 | improvement | {count} static assets have no caching headers. | Send Cache-Control for static files. |
| SPD-053 | improvement | {count} versioned static assets are cached for less than {days} days. | Files with a hash or version in their name can be cached for a year with Cache-Control: immutable. The 30 day limit is the one Lighthouse uses. |
| SPD-054 | improvement | {count} static assets cannot be cached (no-store, or no-cache without a validator). | Allow caching, or at least send an ETag so that browsers can revalidate. |

## a11y

axe-core runs in Chrome, page by page. There is one finding per axe rule per audit. The axe impact decides the severity: critical and serious become important, moderate and minor become improvement. This module never emits a critical finding. The Lighthouse accessibility score is stored as a fact, and is not a finding.

| Code | Severity | What it means | How to fix it |
| --- | --- | --- | --- |
| A11Y-001 | important (axe impact critical or serious) | Rule {ruleId} (impact {impact}): {help} ({elements} elements on {pages} pages). | Follow the help link in the finding data. Evidence lists the pages and up to 10 selectors. |
| A11Y-002 | improvement (axe impact moderate, minor or none) | Rule {ruleId} (impact {impact}): {help} ({elements} elements on {pages} pages). | Follow the help link in the finding data. Evidence lists the pages and up to 10 selectors. |
