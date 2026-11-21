import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome110",
    outDir: "dist",
    sourcemap: false,
    cssCodeSplit: true,
    reportCompressedSize: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "radix", test: /[\\/]node_modules[\\/](radix-ui|@radix-ui)[\\/]/ },
            { name: "tauri", test: /[\\/]node_modules[\\/]@tauri-apps[\\/]/ },
          ],
        },
      },
    },
  },
});
