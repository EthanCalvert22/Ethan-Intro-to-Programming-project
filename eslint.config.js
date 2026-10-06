import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist", "coverage", "playwright-report", "test-results", "node_modules"],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Source code avoids the "!" operator; a named type assertion reads more clearly.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // In tests, "!" is a fine way to say "this must exist, or the test should fail".
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      // Lets a test helper say which kind of element it expects to find.
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
    },
  },
  {
    // The domain is the rulebook: it must never reach into saving or the screen.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["../storage/*", "../ui/*", "**/storage/**", "**/ui/**"] },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "Date", "console"],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "The first release has no randomness." },
      ],
    },
  },
);
