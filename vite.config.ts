import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content Security Policy: the browser's allow-list for this page.
// - Scripts, styles, fonts and images may only come from this site itself ('self').
// - The page may only send network requests to itself and to api.anthropic.com,
//   so no other script or server can receive a visitor's API key or PDF text.
// - No third-party scripts, analytics or fonts are allowed at all.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.anthropic.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

// Adds the policy as a <meta> tag to the built index.html only. The local dev
// server injects its own styles and live-reload connection, which this strict
// policy would block, so `npm run dev` runs without it.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/conference-agenda-digest/
  base: '/conference-agenda-digest/',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    // Keep every font and image as a separate file instead of an inline data: URL,
    // so everything stays covered by the 'self' rules above.
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
