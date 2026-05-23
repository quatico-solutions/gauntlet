import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile({ removeViteModuleLoader: true, inlineAllAssets: true }),
  ],
  build: {
    outDir: "dist-static",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(here, "static.html"),
    },
  },
});
