# Changelog

## Unreleased

- Add the project skeleton, tooling and documentation structure.
- Add argument parsing and validation for every parameter in SCOPE.md.
- Add the config validator, loader and settings merge.
- Add the crawler: host variant detection, robots.txt, sitemaps, redirect tracing, TLS probe and external link checks.
- Add the modules links, ssl, headers, seo, content, email and ai with 120 finding codes. Speed and a11y report "not measured".
- Add `audit.json` (schema version `0-interim`) and the terminal summary.
- Add the config fields `concurrency`, `thinContentWords` and `email.dkimSelectors`.
- Add `docs/checks.md` with every code, its severity and its fix.
- Refuse requests to private addresses, stay on the given domain when it redirects elsewhere, match robots.txt patterns in linear time and stop SPF lookups at the limit.
- Judge IPv6 addresses by their bytes and refuse public names that resolve to private addresses.
- Read sitemaps that start with a stylesheet instruction, as sitemap plugins write them.
- Check the address of every connection inside the DNS lookup of the socket, which stops DNS rebinding. Add undici as a dependency for this.
