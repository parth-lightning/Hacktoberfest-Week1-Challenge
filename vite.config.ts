import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function threeUiSylvaAssets() {
  const packageJsonPath = fileURLToPath(
    import.meta.resolve("@designcodeio/threeui/package.json"),
  );
  const packageAssets = resolve(
    dirname(packageJsonPath),
    "lib-dist",
    "assets",
    "landing-pages",
  );

  return {
    name: "threeui-sylva-assets",
    configResolved(config: { publicDir: string | false }) {
      if (!config.publicDir) {
        throw new Error("ThreeUI Sylva requires Vite's public directory.");
      }

      const destination = resolve(config.publicDir, "landing-pages");
      mkdirSync(destination, { recursive: true });
      copyFileSync(
        resolve(packageAssets, "inner-green-3d.html"),
        resolve(destination, "inner-green-3d.html"),
      );
      cpSync(
        resolve(packageAssets, "inner-green-assets"),
        resolve(destination, "inner-green-assets"),
        { recursive: true },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), threeUiSylvaAssets()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
