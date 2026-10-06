import { formatEuros } from "./money";
import { MAX_ORDER_QUANTITY, MAX_PRICE_CENTS } from "./rules";

/** Every reason the café can refuse an action. Each comes with a message for the player. */
export type ShopErrorKind =
  "NotAffordable" | "InvalidQuantity" | "InvalidPrice" | "UnknownProduct" | "RunCompleted";

export interface ShopError {
  readonly kind: ShopErrorKind;
  readonly message: string;
}

export function notAffordable(costCents: number, cashCents: number): ShopError {
  return {
    kind: "NotAffordable",
    message: `Oops, that order comes to ${formatEuros(costCents)}, but you only have ${formatEuros(cashCents)} left.`,
  };
}

export function runCompleted(): ShopError {
  return {
    kind: "RunCompleted",
    message: "The café has closed for this run. Start a new run to trade again.",
  };
}

export function unknownProduct(productId: string): ShopError {
  return {
    kind: "UnknownProduct",
    message: `I couldn't find "${productId}" on the menu.`,
  };
}

export const quantityProblems = {
  missing: "Please tell me how many to order, like 5.",
  notWhole: "I can only order whole items, so please use a whole number like 5.",
  tooFew: "I need to order at least 1.",
  tooMany: `I can order at most ${MAX_ORDER_QUANTITY.toLocaleString("en-GB")} at a time.`,
} as const;

export function invalidQuantity(problem: keyof typeof quantityProblems): ShopError {
  return { kind: "InvalidQuantity", message: quantityProblems[problem] };
}

export const priceProblems = {
  missing: "Please type a price, like 2.80.",
  unreadable: "I couldn't read that price. Please write it like 2.80 or 2,80.",
  tooPrecise: "Prices only go down to the cent, so please use at most two decimals, like 4.50.",
  notPositive: "A price has to be more than €0.00.",
  tooHigh: `That's more than my till can ring up. Please keep prices at ${formatEuros(MAX_PRICE_CENTS)} or less.`,
} as const;

export function invalidPrice(problem: keyof typeof priceProblems): ShopError {
  return { kind: "InvalidPrice", message: priceProblems[problem] };
}
