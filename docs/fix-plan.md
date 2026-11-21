# FIX_PLAN.md

`FIX_PLAN.md` is an ordered list of tasks that Claude follows until the renewal is done. It is always written in English.

## Rules for Claude

The file starts with these rules:

- Work from top to bottom, one task at a time.
- Do not move to the next task before the acceptance criteria are verified with `/cwa verify`.
- Do not skip any task. If blocked, write the reason in the file and stop.
- Do not read or modify .env files, keys or secrets folders. Stay inside the open project folder.
- Keep the existing design and components. Do not change visible text without approval.
- Tasks that need user input are placed last and are asked about, not guessed.
- When all tasks are done, run `/cwa recheck` and report the comparison.

## Task format

Each task has an id, a title, a priority (P0 to P3), a module, a status checkbox, evidence URLs, the reason, numbered steps, acceptance criteria, a verify command and a flag for user input.

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

## Ordering

Tasks are ordered by priority. Tasks that touch the same file are grouped together, so Claude opens each file once. Tasks that need user input come last.

## Verification

`/cwa verify <task-id>` re-measures the acceptance criteria of one task against the live site or the local build. A task is done only when its criteria pass.
