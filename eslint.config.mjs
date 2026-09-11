import js from "@eslint/js";
import globals from "globals";
import security from "eslint-plugin-security";

export default [
  js.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "security/detect-object-injection": "off",
    },
  },
  {
    // The viewer pulls these three in as UMD globals from <script> tags.
    files: ["viewer/**/*.js"],
    languageOptions: {
      globals: {
        graphology: "readonly",
        graphologyLibrary: "readonly",
        Sigma: "readonly",
      },
    },
  },
];
