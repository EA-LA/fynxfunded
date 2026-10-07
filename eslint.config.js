import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "functions/lib"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The shadcn component modules intentionally co-export variants/hooks.
      "react-refresh/only-export-components": "off",
      // Firestore and external provider payloads are runtime-validated and have
      // intentionally dynamic fields throughout the current service layer.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // These exact files are generated from the canonical JavaScript policy in
    // FYNX API. Keep arithmetic identical; parity tests exercise both copies.
    files: ["functions/src/apiRuleEngine.ts", "functions/src/fundedPolicy.ts", "functions/src/purchasedAgreement.ts", "src/services/api-rule-engine.ts", "src/services/funded-policy.ts"],
    rules: { "@typescript-eslint/ban-ts-comment": ["error", { "ts-nocheck": false }] },
  },
);
