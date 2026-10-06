import { el } from "./dom";

/**
 * The "Start a new run?" confirmation, using the native <dialog> element.
 * Focus starts on Cancel, so pressing Enter by accident never wipes a run.
 */
export class NewRunDialog {
  readonly element: HTMLDialogElement;
  private readonly details: HTMLElement;

  constructor(onConfirm: () => void) {
    this.details = el("p", { id: "new-run-details" });
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
          el("div", { class: "dialog-actions" }, [cancel, confirm]),
        ]),
      ],
    );
    this.element.addEventListener("close", () => {
      // Escape and Cancel both leave returnValue as something other than "confirm".
      if (this.element.returnValue === "confirm") {
        onConfirm();
      }
    });
  }

  open(currentRunDescription: string): void {
    this.details.textContent = `This replaces your current café (${currentRunDescription}) with a fresh one: €100.00, an empty shelf and day 1. It can't be undone.`;
    this.element.returnValue = "";
    this.element.showModal();
  }
}
