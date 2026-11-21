
export interface Upgrade {
  id: string;
  name: string;
  costCents: number;
  description: string;
  duration: "permanent" | "one-day";
  demandBonus: number;
}

export const upgrades: Upgrade[] = [
  {
    id: "loyalty-program",
    name: "Student Loyalty Program",
    costCents: 1500,
    description: "+2 daily demand per product.",
    duration: "permanent",
    demandBonus: 2,
  },
  {
    id: "go-viral",
    name: "Go Viral",
    costCents: 2000,
    description: "+5 demand per product for one day.",
    duration: "one-day",
    demandBonus: 5,
  },
];
