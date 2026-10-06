# Known limitations

Things that are true of this first release, on purpose or by necessity. None of them breaks a requirement in the brief.

## By design (out of scope for the first release)

- **One café, one player, one browser.** Progress is saved in the browser's `localStorage`, so it does not follow you to another browser or device, and clearing site data deletes it.
- **Fixed menu and fixed demand.** No random events, upgrades, competitors, running costs, spoilage, loans or returns, exactly as the brief's scope boundaries say.
- **No undo** for purchases or price changes. Refused actions change nothing, but accepted ones are final (as in a real till).

## Behaviour worth knowing

- **A price that is typed but not applied** is applied when you press Enter, Set price, a ±10 c nudge, or Open for the day. If you type a price and then reload the page before any of those, the typed text is lost and the last applied price is kept (it was never "accepted"). See decision 20 in [DECISIONS.md](DECISIONS.md).
- **Order and price limits:** 1–1,000 units per order and at most €1,000.00 per price (decisions 17 and 18). With €100 starting cash these are never reached in normal play.
- **Comma decimals are accepted, thousands separators are not** (`4,50` is fine; `1,000.00` is refused).
- **Browsers that block storage** (some private-browsing modes) can play, but only until the page is closed. A warning says so.
- **A save made by a newer version** of the game is reported as unreadable rather than guessed at.
- **Two tabs open at once** are not coordinated. Each tab keeps its own copy in memory and the last one to save wins. The brief asks for one user at a time, so this was not addressed.

## Testing scope

- Browser tests run in **Chromium only** (as the brief specifies). The app uses only standard features (`<dialog>`, CSS grid, `localStorage`), but Firefox and Safari were not tested automatically.
- The accessibility scan is automated (axe-core) plus keyboard-only tests. No manual screen-reader session (e.g. NVDA or VoiceOver) was recorded.
- A few defensive branches outside `src/domain/` are not covered by unit tests because they cannot be reached through normal use (they are listed in [TESTING.md](TESTING.md#latest-results)). `src/domain/` itself is covered 100 %.
