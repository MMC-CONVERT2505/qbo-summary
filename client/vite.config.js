import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Docker Desktop's bind mount doesn't reliably forward native filesystem
    // change events from the Windows host into the Linux container, so
    // chokidar's default watcher can silently miss edits — poll instead.
    watch: { usePolling: true, interval: 300 },
    // Must match the redirect URI's hostname so the OAuth session cookie set
    // here is the same one Intuit's callback sees — a cookie scoped to
    // 'localhost' is never sent to a *.nip.io request. Uses the machine's
    // LAN IP rather than 127.0.0.1.nip.io — Intuit's login WAF appears to
    // flag loopback addresses embedded in a redirect_uri as a security risk.
    // Keeps every IP this machine has answered to as it's moved networks —
    // only .env's QBO_REDIRECT_URI needs to match whichever is active now.
    // true — running through an ngrok tunnel now (LAN IP kept changing
    // mid-demo); ngrok's hostname is random per run, not worth hardcoding.
    allowedHosts: true,
    proxy: {
      // Keeps the session cookie same-origin in development.
      // secure: false — the backend uses a locally trusted (mkcert) cert, not a public CA one.
      // VITE_API_TARGET override lets this run in a container (Smart App Control workaround)
      // where 'localhost' means the container, not the Windows host — use host.docker.internal there.
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'https://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      // The OAuth callback is a top-level browser navigation straight to
      // this path (not an XHR under /api), but it still has to land on the
      // same origin the client itself is served from — otherwise the
      // session cookie set during /connect never gets sent back here (the
      // exact "Sign-in state did not match" bug fixed earlier this
      // project). Proxying it here, same as /api, keeps everything (client,
      // API, and this callback) on the single ngrok origin.
      '/quickbooks-return': {
        target: process.env.VITE_API_TARGET ?? 'https://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
