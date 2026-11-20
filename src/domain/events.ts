import { demand } from "./demand";
import { RUN_LENGTH_DAYS } from "./rules";

/*
 * Campus events: something happening on campus that changes how many customers come for
 * some items that day. The price still decides the tier (10, 5 or 0 customers); the event
 * then scales that number up or down. An ordinary day changes nothing, so a run of five
 * ordinary days plays exactly by the original rules.
 */

export interface CampusEvent {
  readonly id: string;
  readonly name: string;
  /** One line for the player: what is happening and who it affects. */
  readonly headline: string;
  /** Percentage of the usual customers, per product id. Items not listed stay at 100%. */
  readonly effects: Readonly<Record<string, number>>;
}

/** "Noticeable" events: half as many, or one and a half times as many customers. */
const FEWER = 50;
const MORE = 150;

export const ORDINARY_DAY: CampusEvent = {
  id: "ordinary-day",
  name: "Ordinary day",
  headline: "A normal day on campus. Customers follow the usual rule.",
  effects: {},
};

export const CAMPUS_EVENTS: readonly CampusEvent[] = [
  ORDINARY_DAY,
  {
    id: "exam-week",
    name: "Exam week",
    headline: "Everyone is cramming: more customers for flat whites and brownies.",
    effects: { "flat-white": MORE, brownie: MORE },
  },
  {
    id: "rainy-day",
    name: "Rainy day",
    headline: "Cold and wet outside: more customers for warm toasties.",
    effects: { toastie: MORE },
  },
  {
    id: "open-day",
    name: "Open day",
    headline: "Visitors all over campus: more customers for everything.",
    effects: { "flat-white": MORE, toastie: MORE, brownie: MORE },
  },
  {
    id: "big-match",
    name: "Big match",
    headline: "Half the campus is at the stadium: fewer customers for everything.",
    effects: { "flat-white": FEWER, toastie: FEWER, brownie: FEWER },
  },
  {
    id: "bake-sale",
    name: "Bake sale next door",
    headline: "A society is selling cakes next door: fewer customers for brownies.",
    effects: { brownie: FEWER },
  },
  {
    id: "heatwave",
    name: "Heatwave",
    headline: "Too hot for hot drinks: fewer customers for flat whites.",
    effects: { "flat-white": FEWER },
  },
];

/** Five ordinary days: the original game, with no events. */
export const CLASSIC_WEEK: readonly string[] = Array.from(
  { length: RUN_LENGTH_DAYS },
  () => ORDINARY_DAY.id,
);

export function findEvent(eventId: string): CampusEvent | undefined {
  return CAMPUS_EVENTS.find((event) => event.id === eventId);
}

export function effectPercent(event: CampusEvent, productId: string): number {
  return event.effects[productId] ?? 100;
}

/** Scales a number of customers by a percentage, rounding half a customer up (2.5 becomes 3). */
export function adjustDemand(baseDemand: number, percent: number): number {
  // Whole-number arithmetic only, like the money: no fractions of a customer are ever stored.
  return Math.floor((baseDemand * percent + 50) / 100);
}

/** How many customers want an item on a day with this event (rule CT R1, then the event). */
export function demandOnDay(priceCents: number, referenceCents: number, percent: number): number {
  return adjustDemand(demand(priceCents, referenceCents), percent);
}

/**
 * A repeatable "random" number sequence (the well-known mulberry32 generator).
 * The same seed always gives the same numbers, so the rules stay pure and testable:
 * the screen picks the seed once when a run starts, and the week it produces is saved.
 */
function seededSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ordinary days are three times as likely as any one special event, so most weeks mix both. */
const ORDINARY_WEIGHT = 3;

/** Picks a week of events from a seed. A special event happens at most once per run. */
export function scheduleFromSeed(seed: number): readonly string[] {
  const next = seededSequence(seed);
  const unusedSpecials = CAMPUS_EVENTS.filter((event) => event !== ORDINARY_DAY).map(
    (event) => event.id,
  );
  const week: string[] = [];
  for (let day = 1; day <= RUN_LENGTH_DAYS; day += 1) {
    const choices = [
      ...Array.from({ length: ORDINARY_WEIGHT }, () => ORDINARY_DAY.id),
      ...unusedSpecials,
    ];
    const pick = choices[Math.floor(next() * choices.length)] as string;
    week.push(pick);
    const used = unusedSpecials.indexOf(pick);
    if (used !== -1) {
      unusedSpecials.splice(used, 1);
    }
  }
  return week;
}
