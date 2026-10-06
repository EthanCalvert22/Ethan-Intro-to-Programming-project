import { afterEach, describe, expect, it, vi } from "vitest";

describe("brewAndByteCatalogue with a broken data file", () => {
  afterEach(() => {
    vi.doUnmock("../../spec/catalogue.json");
    vi.resetModules();
  });

  it("refuses to start with a menu that breaks the rules, and says why", async () => {
    vi.doMock("../../spec/catalogue.json", () => ({
      default: {
        products: [{ id: "only-one", name: "Lonely", unitCostCents: 1, referencePriceCents: 2 }],
      },
    }));
    const { brewAndByteCatalogue } = await import("../../src/domain/catalogue");
    expect(() => brewAndByteCatalogue()).toThrow("The menu needs at least 3 products.");
  });
});
