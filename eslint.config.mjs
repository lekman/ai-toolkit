import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/", "**/node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.mts", "**/*.mjs"],
    plugins: { jsdoc, perfectionist },
    rules: {
      // Sorted imports, and sorted names inside each import.
      "perfectionist/sort-imports": "error",
      "perfectionist/sort-named-imports": "error",

      // Every exported class, function, and public class property carries a
      // comment. Internal helpers are exempt. The fixer stays off: it inserts
      // empty stubs, which satisfy the rule without saying anything.
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            ClassDeclaration: true,
            FunctionDeclaration: true,
            MethodDefinition: true,
          },
          contexts: ['PropertyDefinition:not([accessibility="private"])'],
          checkConstructors: false,
          enableFixer: false,
        },
      ],
    },
  },
];
