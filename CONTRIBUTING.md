# Contributing

Thank you for helping. This project is small and the plan is in [SCOPE.md](SCOPE.md). Please read it before you open a pull request, so the change fits the plan.

## Setup

You need Node.js 22.19 or newer (`.nvmrc` pins the current LTS, 26) and npm.

```
git clone https://github.com/barisgunduz/claude-web-audit.git
cd claude-web-audit
npm ci
npm run check
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compile `src/` to `dist/` |
| `npm run typecheck` | Type-check `src/` and `test/` |
| `npm run lint` | Run ESLint and check formatting with Prettier |
| `npm run format` | Format the code with Prettier |
| `npm test` | Run the unit tests |
| `npm run check` | Typecheck, lint and test. CI runs this and the build. |

Tests never use the internet and never need Chrome. Browser tests (local Lighthouse and axe-core against a local page) are skipped by default. Run them with `CWA_E2E=1 npm test`, on a machine with Chrome.

## Commits

Use short imperative messages, for example "Add robots.txt parser". One logical change per commit. Do not add trailers or signatures to commit messages.

## Code

- TypeScript in strict mode. Avoid `any` and non-null assertions.
- Follow the structure that is there. Add a helper only when something is needed twice.
- Add tests for new logic.
- Keep secrets out of the repo. The PageSpeed key is only read from `PSI_API_KEY`.

## Add a language file

See [translations/README.md](translations/README.md).

## Add a module

1. Create `src/modules/<name>/index.ts`.
2. Add the name to `src/modules/names.ts` and a default weight to `src/config/defaults.ts`. Weights must add up to 100.
3. Add the module name keys to every file in `src/i18n/`.
4. Describe the checks in [docs/modules.md](docs/modules.md).
5. Raise the change against SCOPE.md first, because the module list is part of the scope.

## Pull requests

Use the pull request template. It has three parts:

- **Summary**: 1 to 3 sentences on what changed and why.
- **What changed**: grouped by feature or fix, with what it does, why it is needed and relevant trade-offs. List anything intentionally deferred under "Not included in this PR".
- **Testing**: the specific checks you ran.
