# Build plan

This is the working plan for Brew & Byte. Each milestone ends with the full test suite being run and the result written down honestly.

| #   | Milestone                                                                                                          | Status |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Tooling: `package.json` with pinned versions, TypeScript `strict`, Vite, ESLint, Prettier, Vitest, Playwright      | Done   |
| 2   | Specification: `spec/catalogue.json`, `spec/acceptance.json`, `spec/RULES.md`                                      | Done   |
| 3   | Domain, test-first: write the acceptance runner and unit tests, watch them fail, then implement `src/domain/`      | Done   |
| 4   | Storage: versioned save format, validation, corrupt-save handling, write-count and atomicity tests                 | Done   |
| 5   | Interface: `src/ui/` (Shop controller, shelf cards, chalkboard, till receipt, day chips, final card, dialog)       | Done   |
| 6   | End-to-end tests with Playwright: playthrough, reload, dialog, disabled controls, keyboard, axe, mobile            | Done   |
| 7   | Continuous integration: GitHub Actions running lint, format, typecheck, unit tests with coverage, end-to-end tests | Done   |
| 8   | Documentation: README, DECISIONS, EXPLAINED, TESTING, KNOWN_LIMITATIONS, screenshots                               | Done   |
| 9   | Final verification: fresh clone following the README, CI green, line-by-line review against the brief              | Done   |

## Order of work

`spec/` → domain and its tests → storage → interface → end-to-end tests → CI → docs → final verification.

## Results log

The results of each milestone run are summarised in [TESTING.md](TESTING.md#latest-results).
