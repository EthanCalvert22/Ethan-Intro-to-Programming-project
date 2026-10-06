import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "playwright-report", "test-results", "node_modules"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
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
      eqeqeq: ["error", "always"],
      "no-console": "error",
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
