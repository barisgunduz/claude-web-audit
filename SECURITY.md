# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub security advisories:

https://github.com/barisgunduz/claude-web-audit/security/advisories/new

Do not open a public issue for a vulnerability. You will get a first answer as soon as the maintainer can read the report.

## API keys

The PageSpeed Insights API key is read only from the `PSI_API_KEY` environment variable. It is never a command-line parameter and never goes into the repo, the config file, a report, a log or any output file. If you find a path where the key can leak, report it as a vulnerability.

## Scope

The crawler obeys robots.txt, uses a polite request rate and stays on the given domain. Report any case where it does not.
