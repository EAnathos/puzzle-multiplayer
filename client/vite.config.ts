import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le build est servi par le serveur Express (même origine que Socket.IO).
// En dev (`npm run dev:client`), on relaie /socket.io vers le serveur.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [".."] },
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
    },
  },
});
