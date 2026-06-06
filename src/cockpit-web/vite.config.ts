import { defineConfig } from "vite";

export default defineConfig({
  root: "src/cockpit-web",
  server: {
    host: "127.0.0.1",
    port: 18793
  },
  build: {
    outDir: "../../dist/cockpit-web",
    emptyOutDir: true
  }
});
