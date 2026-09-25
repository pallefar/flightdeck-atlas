import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party Cesium build copied in by scripts/prepare-globe.mjs
    // (gitignored); it is not Atlas source.
    "public/cesium/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // lib/pagedoc is a byte-for-byte mirror of the OS PageDoc tree
    // (scripts/check-pagedoc-mirror.mjs refuses any edit here), linted where
    // it is written, in the OS. Atlas's lint adds two React Compiler rules the
    // OS's does not run; each is switched off only in the one file and only
    // for the one rule it reports, as lib/motion/useMotion.ts does for
    // react-hooks/refs. Any other finding in the mirror still fails lint.
    files: ["lib/pagedoc/render/blocks/media.ts"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    files: ["lib/pagedoc/render/blocks/tabs.ts"],
    rules: { "react-hooks/refs": "off" },
  },
]);

export default eslintConfig;
