import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Regenerates docs/screenshots with: npm run screenshots */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "screenshots.spec.ts",
});
