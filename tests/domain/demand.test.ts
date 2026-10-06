import { describe, expect, it } from "vitest";
import { demand } from "../../src/domain/demand";

describe("demand (CT R1)", () => {
  it("is 10 at or below the reference price", () => {
    expect(demand(400, 400)).toBe(10);
    expect(demand(399, 400)).toBe(10);
    expect(demand(1, 400)).toBe(10);
  });

  it("is 5 above the reference price up to and including twice it", () => {
    expect(demand(401, 400)).toBe(5);
    expect(demand(800, 400)).toBe(5);
  });

  it("is 0 above twice the reference price", () => {
    expect(demand(801, 400)).toBe(0);
    expect(demand(100000, 400)).toBe(0);
  });

  it("A2: €4, €4.01, €8 and €8.01 give 10, 5, 5 and 0 for a €4 reference", () => {
    expect([400, 401, 800, 801].map((price) => demand(price, 400))).toEqual([10, 5, 5, 0]);
  });

  it("handles odd reference values exactly (€1.50: €3.00 sells 5, €3.01 sells 0)", () => {
    expect(demand(300, 150)).toBe(5);
    expect(demand(301, 150)).toBe(0);
  });

  it("is a pure function: same inputs, same answer, every time", () => {
    const answers = Array.from({ length: 20 }, () => demand(450, 450));
    expect(new Set(answers)).toEqual(new Set([10]));
  });
});
