import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true, // claude_prompt.txt (EMS hardening): listen on all interfaces, not just localhost -- so the LAN-friendly API/SSO URL changes in src/services/api.ts are actually reachable from another machine. Requires restarting `npm run dev` to take effect (not done here, per the task's own rule never to restart the user's processes).
    port: 5000
  },
  plugins: [react()],
})
