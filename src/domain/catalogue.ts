import catalogueFile from "../../spec/catalogue.json";

/** One item on the menu. Money is in whole cents. */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly unitCostCents: number;
  readonly referencePriceCents: number;
}

/** The menu, in the order it is shown and traded. */
export type Catalogue = readonly Product[];

export type CatalogueCheck =
  | { readonly ok: true; readonly catalogue: Catalogue }
  | { readonly ok: false; readonly problems: readonly string[] };

const MIN_PRODUCTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFilledText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function checkProduct(raw: unknown, position: number): Product | string {
  const label = `Product ${position + 1}`;
  if (!isRecord(raw)) {
    return `${label} is not a product.`;
  }
  const { id, name, unitCostCents, referencePriceCents } = raw;
  if (!isFilledText(id)) {
    return `${label} needs an id.`;
  }
  if (!isFilledText(name)) {
    return `${label} needs a name.`;
  }
  if (!isPositiveWholeNumber(unitCostCents)) {
    return `${label} needs a unit cost in whole cents above zero.`;
  }
  if (!isPositiveWholeNumber(referencePriceCents)) {
    return `${label} needs a reference price in whole cents above zero.`;
  }
  return { id, name, unitCostCents, referencePriceCents };
}

/** Checks a menu before the game uses it: at least three products, unique ids, positive cents. */
export function checkCatalogue(raw: unknown): CatalogueCheck {
  if (!Array.isArray(raw)) {
    return { ok: false, problems: ["The menu must be a list of products."] };
  }
  const problems: string[] = [];
  const products: Product[] = [];
  const seenIds = new Set<string>();
  raw.forEach((entry: unknown, position) => {
    const checked = checkProduct(entry, position);
    if (typeof checked === "string") {
      problems.push(checked);
      return;
    }
    if (seenIds.has(checked.id)) {
      problems.push(`Product id "${checked.id}" is used twice.`);
    }
    seenIds.add(checked.id);
    products.push(checked);
  });
  if (raw.length < MIN_PRODUCTS) {
    problems.push(`The menu needs at least ${MIN_PRODUCTS} products.`);
  }
  return problems.length === 0 ? { ok: true, catalogue: products } : { ok: false, problems };
}

/** The Brew & Byte menu from spec/catalogue.json. Throws only if the shipped data file is broken. */
export function brewAndByteCatalogue(): Catalogue {
  const checked = checkCatalogue(catalogueFile.products);
  if (!checked.ok) {
    throw new Error(`The Brew & Byte menu is invalid: ${checked.problems.join(" ")}`);
  }
  return checked.catalogue;
}

export function findProduct(catalogue: Catalogue, productId: string): Product | undefined {
  return catalogue.find((product) => product.id === productId);
}
