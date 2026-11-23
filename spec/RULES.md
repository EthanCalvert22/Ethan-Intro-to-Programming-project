# Brew & Byte rules, in plain language

These are the rules the game follows. The code in `src/domain/` implements them, and `spec/acceptance.json` checks them with concrete numbers.

## The run

- You run a campus café called Brew & Byte for **five trading days**.
- You start with **€100.00** in the till and an **empty shelf** (zero stock of everything).
- The menu has three items. Each has a fixed **unit cost** (what you pay the supplier) and a fixed **reference price** (what customers think is fair):

| Item       | Unit cost | Reference price |
| ---------- | --------- | --------------- |
| Flat white | €1.20     | €2.80           |
| Toastie    | €2.00     | €4.50           |
| Brownie    | €0.70     | €1.80           |

- The run starts on **day 1**. The day shown is always the day you are about to trade. After you trade day 5, the run is **complete**: the screen shows "5 of 5 days complete" and the final results, and the day counter stays at 5.

## Money

- All amounts are in euros with at most two decimals. Inside the game every amount is stored as a whole number of **cents** (€4.01 is 401), so there is never any rounding.
- Cash and stock can never go below zero.

## Buying stock

- You can buy any time before you trade, as long as the run is not complete.
- A quantity must be a **whole number from 1 to 1,000** per order. Spaces around it are ignored. `0`, negatives, decimals like `2.5`, words, and numbers in other notations (like `1e3`) are refused.
- The order costs `quantity × unit cost`. If that is more than the cash you have, the order is refused and nothing changes. Spending exactly all your cash is allowed.
- An accepted order takes the money and adds the stock in one step.

## Setting prices

- Every item starts the run priced at its reference price.
- You can change a price any time before you trade, as long as the run is not complete. A price stays until you change it, across days.
- A price must be **more than €0.00 and at most €1,000.00**, with **at most two decimals**. You may write a dot or a comma for the decimals (`4.50` and `4,50` both mean €4.50). Spaces around it are ignored. Anything else (`4.005`, `abc`, `1e2`, an empty box, `€4.50`, `1,000.00`) is refused and the old price stays.

## How customers decide (demand)

For each item, every day:

| Your price                          | Customers who want it |
| ----------------------------------- | --------------------- |
| at or below the reference price     | 10                    |
| above the reference, up to twice it | 5                     |
| more than twice the reference price | 0                     |

The comparison is done exactly in cents. With a €4.00 reference: €4.00 → 10, €4.01 → 5, €8.00 → 5, €8.01 → 0. On an ordinary day that number is final.

## Campus events (version 2)

- Each run has a **week of campus events**, one per day. The week is chosen when the run starts and saved with it, so reloading never changes it.
- Each day the screen shows **today's event and tomorrow's**. Later days are a surprise.
- An event **scales the number of customers** for the items it names: to 1.5 times (more customers) or 0.5 times (fewer). Items it doesn't name are unchanged. The price still decides the tier first.
- Half a customer **rounds up**: 5 × 1.5 = 7.5 becomes 8, and 5 × 0.5 = 2.5 becomes 3. Zero stays zero.
- A special event happens **at most once per run**; ordinary days can repeat.
- **New run** can start a **classic week**: five ordinary days, which is exactly the original game.

| Event               | Effect                       |
| ------------------- | ---------------------------- |
| Ordinary day        | No change                    |
| Exam week           | Flat white and brownie × 1.5 |
| Rainy day           | Toastie × 1.5                |
| Open day            | Everything × 1.5             |
| Big match           | Everything × 0.5             |
| Bake sale next door | Brownie × 0.5                |
| Heatwave            | Flat white × 0.5             |

## Trading a day

- Pressing **Open for the day** trades exactly one day.
- For each item: **units sold = the smaller of demand and stock on the shelf**. Unsold stock stays on the shelf for the next day. Nothing spoils, there are no running costs, no loans and no returns.
- **Revenue** = units sold × your price. It goes into the till.
- **Cost of goods sold** = units sold × unit cost. This money was already spent when you bought the stock, so it is **not** taken from the till again.
- **Gross profit** = revenue − cost of goods sold.
- The day's receipt shows these numbers for each item and in total, and is recorded in the history together with the new cash and stock. Trading with an empty shelf is allowed: it records a day with no sales and moves on.

## The end of the run

- After day 5, buying, pricing and trading are switched off.
- The final results show: **final cash**, **remaining stock valued at unit cost**, and the **overall gain or loss** = final cash + remaining stock at cost − €100.00.
- Because buying stock just swaps cash for stock of the same value, the overall gain or loss always equals the sum of the five days' gross profit. Your cash alone changed by that amount minus the cost of the stock still on the shelf.

## Upgrades shop (version 3)

| Upgrade                 | Cost   | Effect                                                     |
| ----------------------- | ------ | ---------------------------------------------------------- |
| Student Loyalty Program | €15.00 | +2 customers per item, every day from the day it is bought |
| Go Viral                | €20.00 | +5 customers per item, on the day it is bought only        |
| Supplier Partnership    | €25.00 | 15% off every stock order from the day it is bought        |

- Each upgrade can be bought **once per run**, only while the run is in progress, and only with enough cash.
- **Customers = price tier (10/5/0) → the day's event (×1.5 or ×0.5) → + upgrade bonuses.** Bonuses only add to items that already have customers, so an item priced above twice its fair price still sells nothing.
- **Supplier rate:** unit cost × 85%, rounded to the nearest cent (half a cent up). Units bought at the supplier rate are tracked; older full-price units sell first. Cost of goods sold and leftover stock use what each unit really cost.
- **Upgrades are spending.** They reduce cash and therefore the overall gain or loss.

## Results dashboard

- From the first traded day, **Your week so far** shows: gross profit so far, money spent on upgrades, the **result so far** (gross profit − upgrade spending, the same as the overall gain or loss), the best-selling item and the best day.
- A bar chart shows **each day's gross profit**: bars go up for a profit and down for a loss, each labelled with its amount.

## High scores

- When day 5 is traded, the run's **overall gain or loss** becomes its score.
- The game keeps the **best five scores across all runs**, best first, each with the **date** and an **Events** or **Classic** tag.
- An equal score goes **below** the older one. A score outside the top five isn't added.
- Each run is recorded **once**, at the moment it finishes. Reloading never adds it again.
- **New run** keeps the high scores. **Clear high scores** removes them all, after a confirming second click.

## Saving and resuming

- Every accepted purchase and price change is saved straight away. Each traded day is saved together with the new cash, stock and day in one single write.
- Refused actions change nothing and save nothing.
- Closing and reopening the app picks up exactly where you left off. Reopening never trades a day again.
- **New run** asks for confirmation. Cancel keeps everything. Confirm starts again with €100.00, an empty shelf, day 1 and no history.
- If the saved game cannot be read, the app says so, keeps a backup copy of the unreadable save, and lets you start fresh.
