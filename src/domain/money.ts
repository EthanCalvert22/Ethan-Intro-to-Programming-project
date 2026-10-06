/** Money is held as whole cents everywhere; these helpers only turn cents into text for people. */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 123456 becomes "€1,234.56"; -1240 becomes "-€12.40". */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}€${groupThousands(String(euros))}.${String(remainder).padStart(2, "0")}`;
}

/** Like formatEuros, but a gain gets a "+" so gains and losses are never confused. */
export function formatSignedEuros(cents: number): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

/** 280 becomes "2.80", the way the price box shows it. */
export function formatPriceForInput(cents: number): string {
  const euros = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${euros}.${String(remainder).padStart(2, "0")}`;
}
