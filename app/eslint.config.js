import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "scripts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Any raw HTML injection is a security risk (see R6 in docs/rework/RISKS.md).
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML запрещён: данные должны экранироваться React.",
        },
      ],
    },
  },
);
