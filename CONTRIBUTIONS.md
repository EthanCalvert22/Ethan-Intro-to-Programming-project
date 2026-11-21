# Contributions

## Version 1.0: the first release

The base game (buying, pricing, trading, saving, the five-day run and its tests) was built by **Ethan**.

## Version 2.0: improvements

Each team member proposed, directed, tested and merged one improvement. Viktoria built the upgrades shop on her own branch from her own GitHub account (with help from the Codex AI tool); it was then combined with the other features in the shared Claude Code session. All of the code was built in one shared Claude Code session on Ethan's subscription, the only one the group could afford; each owner typed the requests for their own feature, made its design decisions and checked the result.

| Feature                                                                                                                                | Owner    | Branch                      | Main files                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrades shop: loyalty program, go viral and supplier partnership, with exact costs for discounted stock                               | Viktoria | `feature/upgrades-viktoria` | `src/domain/upgrades.ts`, `src/ui/upgradesShop.ts`, `tests/domain/upgrades.test.ts`, `e2e/upgrades.spec.ts`                                       |
| High scores: the best five finished runs across runs, with dates, an Events/Classic tag, a rank on the final card and a two-step clear | Gina     | `feature/highscores-gina`   | `src/domain/highScores.ts`, `src/storage/scoreStore.ts`, `src/ui/highScoresPanel.ts`, `tests/domain/highScores.test.ts`, `e2e/highscores.spec.ts` |
| Campus events: a planned week of events that change demand, with a "Campus news" forecast for today and tomorrow                       | Avery    | `feature/events-avery`      | `src/domain/events.ts`, `src/ui/campusNews.ts`, `tests/domain/events.test.ts`, `e2e/events.spec.ts`                                               |
