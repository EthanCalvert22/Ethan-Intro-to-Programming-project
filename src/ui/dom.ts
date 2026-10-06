/** A tiny helper for building the page with plain DOM calls, no framework. */

export type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/** Builds an element from a fixed, trusted SVG string that ships with the app (never user text). */
export function svgFromMarkup(markup: string): Element {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild as Element;
}

/** Text that screen readers hear but that is not shown on screen. */
export function srOnly(text: string): HTMLSpanElement {
  return el("span", { class: "sr-only" }, [text]);
}
