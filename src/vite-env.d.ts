/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID from Google Cloud Console (see README). */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

declare module 'virtual:logo-urls' {
  /** Logo id → bundled SVG URL (see logosPlugin.ts). */
  const urls: Record<string, string>
  export default urls
}
