import { el } from "./dom";

/**
 * The "Start a new run?" confirmation, using the native <dialog> element.
 * Focus starts on Cancel, so pressing Enter by accident never wipes a run.
 * A tick box chooses between a week with campus events and the classic week.
 */
export class NewRunDialog {
  readonly element: HTMLDialogElement;
  private readonly details: HTMLElement;
  private readonly withEvents: HTMLInputElement;

  constructor(onConfirm: (withEvents: boolean) => void) {
    this.details = el("p", { id: "new-run-details" });
    this.withEvents = el("input", { type: "checkbox", id: "new-run-events" });
    const cancel = el(
      "button",
      { type: "submit", value: "cancel", class: "button button-quiet", autofocus: "" },
      ["Cancel"],
    );
    const confirm = el(
      "button",
      { type: "submit", value: "confirm", class: "button button-danger" },
      ["Yes, start a new run"],
    );
    this.element = el(
      "dialog",
      {
        class: "dialog",
        "aria-labelledby": "new-run-title",
        "aria-describedby": "new-run-details",
      },
      [
        el("form", { method: "dialog" }, [
          el("h2", { id: "new-run-title" }, ["Start a new run?"]),
          this.details,
          el("p", { class: "dialog-option" }, [
            this.withEvents,
            el("label", { for: "new-run-events" }, [
              "Include campus events",
              el("span", { class: "hint" }, [
                " (untick for a classic week that follows the original rules)",
              ]),
            ]),
          ]),
          el("div", { class: "dialog-actions" }, [cancel, confirm]),
        ]),
      ],
    );
    this.element.addEventListener("close", () => {
      // Escape and Cancel both leave returnValue as something other than "confirm".
      if (this.element.returnValue === "confirm") {
        onConfirm(this.withEvents.checked);
      }
    });
  }

  open(currentRunDescription: string): void {
    this.details.textContent = `This replaces your current café (${currentRunDescription}) with a fresh one: €100.00, an empty shelf and day 1. It can't be undone.`;
    this.element.returnValue = "";
    this.withEvents.checked = true;
    this.element.showModal();
  }
}
