// Компилира скриптовете за контейнера в самостоятелни ESM файлове (с вградени
// drizzle-orm, pg и zod), за да не зависят от node_modules на standalone output-а.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outdir: "dist-scripts",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  legalComments: "none",
  // pg опционално изисква pg-native; не го ползваме.
  external: ["pg-native"],
  // ESM bundle с CommonJS зависимости (pg) има нужда от require().
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

await build({
  ...common,
  entryPoints: { migrate: "scripts/migrate.ts", "bootstrap-admin": "scripts/bootstrap-admin.ts" },
});
