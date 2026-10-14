import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Strict Content Security Policy, injected only into production builds
 * (the dev server needs inline scripts for React Fast Refresh).
 * The Google access token lives in the browser, so XSS is the main risk: only our own scripts plus
 * Google's sign-in library may run, and the only remote hosts are the Drive API and Google sign-in.
 * 'unsafe-inline' for styles is required by CodeMirror's runtime style injection.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  'frame-src https://accounts.google.com/gsi/',
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'wisp-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
})
