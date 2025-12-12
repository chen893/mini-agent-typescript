import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * ESLint Flat Config（ESLint v9+）。
 *
 * 说明：
 * - 这是教学项目的“可读 + 常用”配置，不追求极致严格。
 * - 规则尽量偏向 TypeScript 工程实践（避免 any 漫天飞、避免未处理 Promise 等）。
 * - 与 Prettier 配合：格式交给 Prettier，ESLint 不重复管格式（eslint-config-prettier）。
 */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "workspace/**"]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      // 基础：让代码更“可靠”而不是更“漂亮”
      "no-console": "off", // CLI 项目允许 console
      "no-debugger": "warn",

      // TypeScript 常见坑
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }]
    }
  },
  eslintConfigPrettier
];

