import type { ShopError } from "./errors";

/** Either the new value, or the reason the action was refused. Nothing is ever thrown. */
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ShopError };

export function accept<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function refuse<T>(error: ShopError): Outcome<T> {
  return { ok: false, error };
}
