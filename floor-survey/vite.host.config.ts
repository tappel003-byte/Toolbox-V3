import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Library build: proven Floor Survey UI mounted into Toolbox as IIFE + CSS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: resolve(__dirname, "../js/floor-survey"),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/host/mount.tsx"),
      name: "ToolboxFloorSurvey",
      formats: ["iife"],
      fileName: () => "floor-survey.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "floor-survey.[ext]",
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
    target: "es2020",
  },
});
