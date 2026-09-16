import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      // The published CLI bundle: generated output, not source.
      "packages/cli/bin/**",
      "**/.next/**",
      "**/build/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain ESM build scripts. TypeScript files get Node's globals from the
    // compiler; these do not, so `no-undef` needs telling what exists.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        // Node has had these since 18. They are globals rather than imports,
        // so `no-undef` has to be told, the same as the three above.
        fetch: "readonly",
        FormData: "readonly",
        Blob: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
