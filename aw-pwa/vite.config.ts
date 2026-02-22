import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,

      pwaAssets: {
        disabled: false,
        config: true,
      },

      manifest: {
        name: "Aisle Whisper PWA",
        short_name: "AW-PWA",
        description:
          "Real‑time store shelf audit (camera + voice) with overlays, checklist, and print preview.",
        theme_color: "#ffffff",
        display: "standalone",
        orientation: "portrait-primary",
        icons: [
          {
            src: "icons/aisle-whisper-icon-48x48.png",
            sizes: "48x48",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-48x48-maskable.png",
            sizes: "48x48",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-72x72.png",
            sizes: "72x72",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-72x72-maskable.png",
            sizes: "72x72",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-96x96.png",
            sizes: "96x96",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-96x96-maskable.png",
            sizes: "96x96",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-144x144.png",
            sizes: "144x144",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-144x144-maskable.png",
            sizes: "144x144",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-192x192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-256x256.png",
            sizes: "256x256",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-256x256-maskable.png",
            sizes: "256x256",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-384x384.png",
            sizes: "384x384",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-384x384-maskable.png",
            sizes: "384x384",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-icon-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/aisle-whisper-master-1024.png",
            sizes: "1024x1024",
            type: "image/png",
          },
          {
            src: "icons/aisle-whisper-master-1024-maskable.png",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
      },

      devOptions: {
        enabled: false,
        navigateFallback: "index.html",
        suppressWarnings: true,
        type: "module",
      },
    }),
  ],
});
