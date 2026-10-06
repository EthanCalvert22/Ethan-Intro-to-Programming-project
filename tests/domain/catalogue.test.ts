import { describe, expect, it } from "vitest";
import catalogueFile from "../../spec/catalogue.json";
import { brewAndByteCatalogue, checkCatalogue, findProduct } from "../../src/domain/catalogue";

const good = [
  { id: "a", name: "A", unitCostCents: 100, referencePriceCents: 200 },
  { id: "b", name: "B", unitCostCents: 50, referencePriceCents: 75 },
  { id: "c", name: "C", unitCostCents: 1, referencePriceCents: 2 },
];

function problemsOf(raw: unknown): readonly string[] {
  const checked = checkCatalogue(raw);
  return checked.ok ? [] : checked.problems;
}

describe("the Brew & Byte menu", () => {
  it("matches spec/catalogue.json and passes validation", () => {
    const menu = brewAndByteCatalogue();
    expect(menu).toEqual(catalogueFile.products);
    expect(menu.map((product) => product.name)).toEqual(["Flat white", "Toastie", "Brownie"]);
  });

  it("finds products by id", () => {
    const menu = brewAndByteCatalogue();
    expect(findProduct(menu, "toastie")?.unitCostCents).toBe(200);
    expect(findProduct(menu, "espresso")).toBeUndefined();
  });
});

describe("checkCatalogue", () => {
  it("accepts a valid menu", () => {
    expect(checkCatalogue(good)).toEqual({ ok: true, catalogue: good });
  });

  it("requires a list", () => {
    expect(problemsOf({ products: good })).toEqual(["The menu must be a list of products."]);
  });

  it("requires at least three products", () => {
    expect(problemsOf(good.slice(0, 2))).toContain("The menu needs at least 3 products.");
  });

  it("requires unique ids", () => {
    expect(problemsOf([...good, { ...good[0] }])).toContain('Product id "a" is used twice.');
  });

  it.each([
    ["not an object", "oops"],
    ["missing id", { name: "X", unitCostCents: 1, referencePriceCents: 2 }],
    ["empty id", { id: "", name: "X", unitCostCents: 1, referencePriceCents: 2 }],
    ["empty name", { id: "x", name: " ", unitCostCents: 1, referencePriceCents: 2 }],
    ["zero cost", { id: "x", name: "X", unitCostCents: 0, referencePriceCents: 2 }],
    ["fractional cost", { id: "x", name: "X", unitCostCents: 1.5, referencePriceCents: 2 }],
    ["string reference", { id: "x", name: "X", unitCostCents: 1, referencePriceCents: "2" }],
    ["negative reference", { id: "x", name: "X", unitCostCents: 1, referencePriceCents: -2 }],
  ])("rejects a product with %s", (_label, product) => {
    expect(problemsOf([...good, product]).length).toBeGreaterThan(0);
  });
});
