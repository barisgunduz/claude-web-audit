# Translations

The repo, its docs and the code are English. Other languages live only in this folder and in the language files.

## Language files

All fixed texts of the report, card and social slides (headings, status labels, table columns, finding descriptions and "not measured") live in one file per language in `src/i18n/`, for example `en.json` and `tr.json`. A missing key falls back to English. Text that comes from the audited site (titles, descriptions, URLs) is never translated.

To add a language:

1. Copy `src/i18n/en.json` to `src/i18n/<code>.json` and translate the values. Keep the keys.
2. Register the file in `src/i18n/index.ts`.
3. Run `npm run check`.

Write the values the way a native speaker would write them. Do not translate word for word.

## Translated READMEs

Each language gets a folder here, such as `translations/tr/`. It holds the translated README, the how-it-works guidance, the examples and small screenshots. These files are community documentation, so the English files stay the source of truth.

Turkish comes first. The Turkish files are written in step 11 of the roadmap.
