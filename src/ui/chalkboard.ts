import { RUN_LENGTH_DAYS } from "../domain/rules";
import { daysCompleted, isComplete, type Run } from "../domain/run";
import { el, srOnly } from "./dom";

type StepState = "done" | "today" | "upcoming";

function stepState(run: Run, day: number): StepState {
  if (day <= daysCompleted(run)) {
    return "done";
  }
  return day === run.currentDay ? "today" : "upcoming";
}

const stateWords: Readonly<Record<StepState, string>> = {
  done: "traded",
  today: "up next",
  upcoming: "to come",
};

/** The day chalkboard: days 1 to 5 as five steps, showing what is done and what is next. */
export class Chalkboard {
  readonly element: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly steps: HTMLLIElement[] = [];

  constructor(run: Run) {
    this.caption = el("p", { class: "chalkboard-caption", "data-testid": "day-progress" });
    const list = el("ol", { class: "chalkboard-steps" });
    for (let day = 1; day <= RUN_LENGTH_DAYS; day += 1) {
      const step = el("li", { class: "chalk-step" });
      this.steps.push(step);
      list.append(step);
    }
    this.element = el(
      "div",
      { class: "chalkboard", role: "group", "aria-label": "Progress through the five-day run" },
      [this.caption, list],
    );
    this.update(run);
  }

  update(run: Run): void {
    this.caption.textContent = isComplete(run)
      ? `${RUN_LENGTH_DAYS} of ${RUN_LENGTH_DAYS} days complete`
      : `Day ${run.currentDay} of ${RUN_LENGTH_DAYS}`;
    this.steps.forEach((step, index) => {
      const day = index + 1;
      const state = stepState(run, day);
      step.className = `chalk-step chalk-${state}`;
      step.replaceChildren(
        el("span", { class: "chalk-mark", "aria-hidden": "true" }, [
          state === "done" ? "✓" : String(day),
        ]),
        el("span", { class: "chalk-label" }, [`Day ${day}`]),
        srOnly(`: ${stateWords[state]}`),
      );
      if (state === "today") {
        step.setAttribute("aria-current", "step");
      } else {
        step.removeAttribute("aria-current");
      }
    });
  }
}
