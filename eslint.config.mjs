// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Config dos pacotes do domínio (`packages/*`).
 * O `apps/web` tem a sua própria, herdada do `eslint-config-next`.
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "apps/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      // `describe`/`it` do node:test devolvem promise por design e o runner as
      // aguarda — a regra não se aplica aqui.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
);
