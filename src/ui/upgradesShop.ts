import { formatEuros } from "../domain/money";
import type { Run } from "../domain/run";
import { upgradeAppliesOn, upgrades, type Upgrade } from "../domain/upgrades";
import { el } from "./dom";

function statusFor(run: Run, upgrade: Upgrade): string {
  if (run.status === "completed") return "Run complete";
  if (upgradeAppliesOn(run, upgrade, run.currentDay)) {
    return upgrade.duration === "permanent" ? "Active for the rest of this run" : "Active today";
  }
  if (run.purchasedUpgrades.includes(upgrade.id)) return "Used";
  if (run.cashCents < upgrade.costCents) return "Not enough cash";
  return "Available";
}

export class UpgradesShop {
  readonly element: HTMLElement;
  private readonly cards;

  constructor(buyUpgrade: (id: string) => void) {
    this.cards = upgrades.map((upgrade) => {
      const status = el("p", { id: `upgrade-status-${upgrade.id}`, class: "hint" });
      const button = el(
        "button",
        { type: "button", class: "button button-secondary", "aria-describedby": status.id },
        [`Buy ${upgrade.name} · ${formatEuros(upgrade.costCents)}`],
      );
      button.addEventListener("click", () => {
        buyUpgrade(upgrade.id);
      });
      const card = el("li", { class: "upgrade-card", "data-upgrade": upgrade.id }, [
        el("h3", {}, [upgrade.name]),
        el("p", { class: "hint" }, [upgrade.description]),
        status,
        button,
      ]);
      return { upgrade, card, button, status };
    });
    this.element = el("section", { class: "panel", "aria-labelledby": "upgrades-title" }, [
      el("h2", { id: "upgrades-title" }, ["Upgrades Shop"]),
      el("p", { class: "hint" }, ["Each upgrade can be bought once per run."]),
      el(
        "ul",
        { class: "upgrade-list" },
        this.cards.map(({ card }) => card),
      ),
    ]);
  }

  update(run: Run): void {
    for (const { upgrade, card, button, status } of this.cards) {
      const bought = run.purchasedUpgrades.includes(upgrade.id);
      button.disabled = run.status === "completed" || bought || run.cashCents < upgrade.costCents;
      button.textContent = bought
        ? `Bought ${upgrade.name}`
        : `Buy ${upgrade.name} · ${formatEuros(upgrade.costCents)}`;
      card.classList.toggle("upgrade-bought", bought);
      status.textContent = statusFor(run, upgrade);
    }
  }
}
