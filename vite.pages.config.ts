import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const staticRoot = realpathSync(resolve("static"));

export default defineConfig({
  root: staticRoot,
  base: process.env.GITHUB_ACTIONS ? "/bollinger-Band-Tracker/" : "/",
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
