import { formatEuros, formatSignedEuros } from "../domain/money";
import type { FinalSummary } from "../domain/run";
import { el } from "./dom";

type Verdict = "gain" | "loss" | "even";

function verdictOf(gainLossCents: number): Verdict {
  if (gainLossCents > 0) {
    return "gain";
  }
  return gainLossCents < 0 ? "loss" : "even";
}

function headline(verdict: Verdict, amount: string): string {
  switch (verdict) {
    case "gain":
      return `Overall gain of ${amount}`;
    case "loss":
      return `Overall loss of ${amount}`;
    case "even":
      return "You broke exactly even";
  }
}

function encouragement(verdict: Verdict): string {
  switch (verdict) {
    case "gain":
      return "Brilliant week at the counter! Your regulars will be back on Monday. Fancy trying to beat it?";
    case "loss":
      return "A tough week, but every café owner learns from their first one. Try a new run and play with your prices.";
    case "even":
      return "Not a cent lost! Next time, see if a few price tweaks can turn it into a profit.";
  }
}

/** The "Final results" card shown after day five, with a message that depends on the outcome. */
export function renderFinalCard(result: FinalSummary, onNewRun: () => void): HTMLElement {
  const verdict = verdictOf(result.gainLossCents);
  const newRunButton = el("button", { type: "button", class: "button button-primary" }, [
    "Start a new run",
  ]);
  newRunButton.addEventListener("click", onNewRun);
  return el(
    "section",
    {
      class: `panel final-card final-${verdict}`,
      "aria-labelledby": "final-title",
      "data-testid": "final-results",
    },
    [
      el("h2", { id: "final-title", tabindex: "-1" }, ["Final results"]),
      el("p", { class: "final-headline", "data-testid": "gain-loss" }, [
        headline(verdict, formatEuros(Math.abs(result.gainLossCents))),
      ]),
      el("dl", { class: "final-figures" }, [
        el("div", {}, [
          el("dt", {}, ["Final cash"]),
          el("dd", { "data-testid": "final-cash" }, [formatEuros(result.finalCashCents)]),
        ]),
        el("div", {}, [
          el("dt", {}, ["Stock left, at what it cost"]),
          el("dd", { "data-testid": "final-stock-value" }, [
            formatEuros(result.remainingStockValueCents),
          ]),
        ]),
        el("div", {}, [
          el("dt", {}, ["Gain or loss on your €100.00"]),
          el("dd", { class: "final-amount" }, [formatSignedEuros(result.gainLossCents)]),
        ]),
      ]),
      el("p", {}, [encouragement(verdict)]),
      newRunButton,
    ],
  );
}
