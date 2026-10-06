import { invalidPrice, invalidQuantity } from "./errors";
import { accept, refuse, type Outcome } from "./result";
import { MAX_ORDER_QUANTITY, MAX_PRICE_CENTS } from "./rules";

/*
 * Turning what the player typed into whole numbers. Text is read with patterns and
 * integer arithmetic only, so "4.01" becomes exactly 401 cents with no floating point.
 */

const WHOLE_NUMBER = /^\d+$/;
const NEGATIVE_NUMBER = /^-\d+(?:[.,]\d+)?$/;
const PRICE = /^\d+(?:[.,]\d{1,2})?$/;
const TOO_MANY_DECIMALS = /^\d+[.,]\d{3,}$/;

/** More digits than this cannot be a sensible order, and could overflow exact arithmetic. */
const MAX_QUANTITY_DIGITS = String(MAX_ORDER_QUANTITY).length;
const MAX_EURO_DIGITS = String(MAX_PRICE_CENTS / 100).length;

/** Reads an order quantity such as " 12 ". Accepts whole numbers from 1 to the order limit. */
export function parseQuantityText(text: string): Outcome<number> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return refuse(invalidQuantity("missing"));
  }
  if (NEGATIVE_NUMBER.test(trimmed)) {
    return refuse(invalidQuantity("tooFew"));
  }
  if (!WHOLE_NUMBER.test(trimmed)) {
    return refuse(invalidQuantity("notWhole"));
  }
  const digits = trimmed.replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_QUANTITY_DIGITS) {
    return refuse(invalidQuantity("tooMany"));
  }
  const quantity = Number(digits);
  if (quantity < 1) {
    return refuse(invalidQuantity("tooFew"));
  }
  if (quantity > MAX_ORDER_QUANTITY) {
    return refuse(invalidQuantity("tooMany"));
  }
  return accept(quantity);
}

/**
 * Reads a selling price in euros such as "4.50" or "4,50" and returns whole cents.
 * Accepts a dot or a comma for the decimals, at most two decimals, and nothing else.
 */
export function parsePriceText(text: string): Outcome<number> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return refuse(invalidPrice("missing"));
  }
  if (NEGATIVE_NUMBER.test(trimmed)) {
    return refuse(invalidPrice("notPositive"));
  }
  if (TOO_MANY_DECIMALS.test(trimmed)) {
    return refuse(invalidPrice("tooPrecise"));
  }
  if (!PRICE.test(trimmed)) {
    return refuse(invalidPrice("unreadable"));
  }
  const separator = trimmed.search(/[.,]/);
  const euroPart = separator === -1 ? trimmed : trimmed.slice(0, separator);
  const centPart = separator === -1 ? "" : trimmed.slice(separator + 1);
  const euroDigits = euroPart.replace(/^0+(?=\d)/, "");
  if (euroDigits.length > MAX_EURO_DIGITS) {
    return refuse(invalidPrice("tooHigh"));
  }
  const cents = Number(euroDigits) * 100 + Number(centPart.padEnd(2, "0"));
  if (cents <= 0) {
    return refuse(invalidPrice("notPositive"));
  }
  if (cents > MAX_PRICE_CENTS) {
    return refuse(invalidPrice("tooHigh"));
  }
  return accept(cents);
}
