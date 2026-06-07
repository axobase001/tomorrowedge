import { defineConfig } from "vite";

export default defineConfig({
  root: "src/cockpit-web",
  server: {
    host: "127.0.0.1",
    port: 18793,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:18792",
        changeOrigin: false
      }
    }
  },
  build: {
    outDir: "../../dist/cockpit-web",
    emptyOutDir: true
  }
});
