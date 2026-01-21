import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const enableLan = process.env.VITE_LAN === "1";
  return {
    plugins: [
      legacy({
        targets: ["defaults", "not IE 11"],
      }),
    ],
    server: {
      port: 5173,
      host: enableLan ? true : "localhost",
      ...(enableLan ? { allowedHosts: ["c-macbook.local"] } : {}),
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
