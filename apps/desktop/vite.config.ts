import { defineConfig } from "vite";

// playwright.config.ts waits on http://127.0.0.1:5173; Vite's default host `localhost` binds only ::1 on macOS.
// No plugin-react: Vite compiles TSX with tsconfig's `jsx: react-jsx`.
export default defineConfig({ server: { host: "127.0.0.1" } });
