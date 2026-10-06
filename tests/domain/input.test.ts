import { describe, expect, it } from "vitest";
import { parsePriceText, parseQuantityText } from "../../src/domain/input";
import { formatEuros, formatPriceForInput, formatSignedEuros } from "../../src/domain/money";

describe("parsePriceText", () => {
  it.each([
    ["4", 400],
    ["4.5", 450],
    ["4.50", 450],
    ["4,50", 450],
    ["  2.80 ", 280],
    ["0.01", 1],
    ["1000", 100000],
  ])("reads %j as %i cents", (text, cents) => {
    expect(parsePriceText(text)).toEqual({ ok: true, value: cents });
  });

  it.each([
    ["", "Please type a price"],
    ["   ", "Please type a price"],
    ["0", "more than €0.00"],
    ["0.00", "more than €0.00"],
    ["-1", "more than €0.00"],
    ["-0.01", "more than €0.00"],
    ["4.005", "at most two decimals"],
    ["4,005", "at most two decimals"],
    ["abc", "couldn't read that price"],
    ["1e2", "couldn't read that price"],
    ["4.", "couldn't read that price"],
    ["1000.01", "€1,000.00 or less"],
    ["12345678901234567890", "€1,000.00 or less"],
  ])("rejects %j with a friendly message", (text, wording) => {
    const outcome = parsePriceText(text);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("InvalidPrice");
      expect(outcome.error.message).toContain(wording);
    }
  });
});

describe("parseQuantityText", () => {
  it.each([
    ["1", 1],
    [" 12 ", 12],
    ["007", 7],
    ["1000", 1000],
  ])("reads %j as %i", (text, quantity) => {
    expect(parseQuantityText(text)).toEqual({ ok: true, value: quantity });
  });

  it.each([
    ["", "how many"],
    ["  ", "how many"],
    ["0", "at least 1"],
    ["-3", "at least 1"],
    ["2.5", "whole number"],
    ["2,5", "whole number"],
    ["abc", "whole number"],
    ["1e3", "whole number"],
    ["1001", "at most 1,000"],
    ["99999999999999999999", "at most 1,000"],
  ])("rejects %j with a friendly message", (text, wording) => {
    const outcome = parseQuantityText(text);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("InvalidQuantity");
      expect(outcome.error.message).toContain(wording);
    }
  });
});

describe("money formatting", () => {
  it.each([
    [0, "€0.00"],
    [5, "€0.05"],
    [401, "€4.01"],
    [10000, "€100.00"],
    [123456, "€1,234.56"],
    [100000000, "€1,000,000.00"],
    [-1240, "-€12.40"],
  ])("formats %i cents as %s", (cents, text) => {
    expect(formatEuros(cents)).toBe(text);
  });

  it("puts an explicit sign on gains and losses", () => {
    expect(formatSignedEuros(2340)).toBe("+€23.40");
    expect(formatSignedEuros(-500)).toBe("-€5.00");
    expect(formatSignedEuros(0)).toBe("€0.00");
  });

  it("writes prices for the input box without a currency sign", () => {
    expect(formatPriceForInput(280)).toBe("2.80");
    expect(formatPriceForInput(100000)).toBe("1000.00");
  });
});
