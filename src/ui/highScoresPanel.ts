import type { Catalogue } from "../domain/catalogue";
import { placeScore, scoreFromRun, type HighScore } from "../domain/highScores";
import { formatSignedEuros } from "../domain/money";
import type { Run } from "../domain/run";
import type { ScoreStore } from "../storage/scoreStore";
import { el, srOnly } from "./dom";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-11-21" becomes "21 Nov 2026", read straight from the text so time zones can't shift it.
 * Saved dates are checked as YYYY-MM-DD when the board loads, so the pieces are always there.
 */
export function formatScoreDate(date: string): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] as string;
  return `${Number(date.slice(8, 10))} ${month} ${date.slice(0, 4)}`;
}

/**
 * The high scores panel: the best five finished runs across all runs, best first, each with
 * its date and whether it had campus events. It records a run's score once, at the moment
 * the run finishes, and offers a two-step "Clear high scores".
 */
export class HighScoresPanel {
  readonly element: HTMLElement;
  private board: readonly HighScore[] = [];
  /** Unreadable saved scores, kept so they can be backed up before anything replaces them. */
  private damagedRaw: string | null = null;
  private highlighted: number | null = null;
  private confirming = false;
  private readonly notice: HTMLElement;
  private readonly list: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly status: HTMLElement;

  constructor(
    private readonly store: ScoreStore,
    private readonly catalogue: Catalogue,
  ) {
    this.notice = el("p", { class: "hint scores-notice" });
    this.list = el("div", { class: "scores-list-slot" });
    this.controls = el("div", { class: "scores-controls" });
    this.status = el("p", { class: "hint", role: "status", "aria-live": "polite" });
    this.element = el(
      "section",
      { class: "panel high-scores", "aria-labelledby": "scores-title" },
      [
        el("h2", { id: "scores-title", tabindex: "-1" }, ["High scores"]),
        this.notice,
        this.list,
        this.controls,
        this.status,
      ],
    );
    this.load();
    this.render();
  }

  /**
   * Records a finished run and returns a sentence for the Final results card. Called once,
   * when day five is traded, so reopening the final screen never adds the same run twice.
   */
  record(run: Run, date: string): string {
    const placed = placeScore(this.board, scoreFromRun(run, this.catalogue, date));
    if (placed.rank === null) {
      // Only a full board can turn a score away, so there is always a best score to mention.
      const best = this.board[0] as HighScore;
      return `Not in your top five this time. Your best is ${formatSignedEuros(best.gainLossCents)}.`;
    }
    const problem = this.saveBoard(placed.board);
    if (problem !== null) {
      return `I couldn't save this high score. ${problem}`;
    }
    this.highlighted = placed.rank - 1;
    this.render();
    return placed.rank === 1
      ? "New personal best! That's your best result yet."
      : `That's number ${placed.rank} on your high scores.`;
  }

  private load(): void {
    const loaded = this.store.load();
    switch (loaded.kind) {
      case "loaded":
        this.board = loaded.board;
        this.notice.hidden = true;
        return;
      case "damaged":
        this.damagedRaw = loaded.raw;
        this.showNotice(
          `I couldn't read your saved high scores (${loaded.problem}) so the board starts empty. A copy of the old scores is kept before anything new is saved.`,
        );
        return;
      case "unavailable":
        this.showNotice(`${loaded.problem} High scores may not be kept.`);
        return;
    }
  }

  private showNotice(text: string): void {
    this.notice.textContent = text;
    this.notice.hidden = false;
  }

  /** Saves a new board, backing up unreadable old scores first. Returns a problem, or null. */
  private saveBoard(board: readonly HighScore[]): string | null {
    if (this.damagedRaw !== null) {
      const backedUp = this.store.backUpDamaged(this.damagedRaw);
      if (!backedUp.ok) {
        return `I couldn't keep a backup of the old high scores first. ${backedUp.problem}`;
      }
      this.damagedRaw = null;
    }
    const saved = this.store.save(board);
    if (!saved.ok) {
      return saved.problem;
    }
    this.board = board;
    this.notice.hidden = true;
    return null;
  }

  private render(): void {
    this.list.replaceChildren(
      this.board.length === 0
        ? el("p", { class: "scores-empty" }, [
            "No finished runs yet. Trade all five days to set your first score.",
          ])
        : el(
            "ol",
            { class: "score-list" },
            this.board.map((score, index) => this.renderScore(score, index)),
          ),
    );
    this.renderControls();
  }

  private renderScore(score: HighScore, index: number): HTMLElement {
    const tone = score.gainLossCents > 0 ? "gain" : score.gainLossCents < 0 ? "loss" : "even";
    const isNew = index === this.highlighted;
    return el(
      "li",
      { class: `score-row${isNew ? " score-new" : ""}`, "data-testid": "score-row" },
      [
        el("span", { class: "score-rank", "aria-hidden": "true" }, [String(index + 1)]),
        srOnly(`Number ${index + 1}: `),
        el("span", { class: `score-amount score-${tone}` }, [
          formatSignedEuros(score.gainLossCents),
        ]),
        el("span", { class: "score-meta" }, [
          `${formatScoreDate(score.date)} · `,
          el("span", { class: `score-tag${score.withEvents ? " score-tag-events" : ""}` }, [
            score.withEvents ? "Events" : "Classic",
          ]),
        ]),
        ...(isNew ? [el("span", { class: "score-badge" }, ["New"])] : []),
      ],
    );
  }

  private renderControls(): void {
    if (!this.confirming) {
      const clear = el("button", { type: "button", class: "button button-quiet scores-clear" }, [
        "Clear high scores",
      ]);
      clear.disabled = this.board.length === 0;
      clear.addEventListener("click", () => {
        this.confirming = true;
        this.renderControls();
        this.controls.querySelector<HTMLButtonElement>(".scores-cancel")?.focus();
      });
      this.controls.replaceChildren(clear);
      return;
    }
    const cancel = el("button", { type: "button", class: "button button-quiet scores-cancel" }, [
      "Cancel",
    ]);
    const confirm = el("button", { type: "button", class: "button button-danger scores-confirm" }, [
      "Yes, clear them",
    ]);
    cancel.addEventListener("click", () => {
      this.finishClearing("Your high scores are unchanged.");
    });
    confirm.addEventListener("click", () => {
      const problem = this.saveBoard([]);
      this.highlighted = null;
      this.finishClearing(
        problem === null ? "High scores cleared." : `I couldn't clear them. ${problem}`,
      );
    });
    const count = this.board.length;
    this.controls.replaceChildren(
      el("p", { class: "scores-confirm-text", id: "scores-confirm-text" }, [
        `Clear all ${count} high score${count === 1 ? "" : "s"}? This can't be undone.`,
      ]),
      el(
        "div",
        {
          class: "scores-confirm-actions",
          role: "group",
          "aria-labelledby": "scores-confirm-text",
        },
        [cancel, confirm],
      ),
    );
  }

  private finishClearing(message: string): void {
    this.confirming = false;
    this.status.textContent = message;
    this.render();
    const clear = this.controls.querySelector<HTMLButtonElement>(".scores-clear");
    if (clear !== null && !clear.disabled) {
      clear.focus();
    } else {
      this.element.querySelector<HTMLElement>("#scores-title")?.focus();
    }
  }
}
