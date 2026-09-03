/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Human-readable build/version string surfaced in the footer. Optional: falls back to "dev". */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Navigator {
  /**
   * Non-standard iOS Safari extension that reports whether the page is running as an
   * installed home-screen app. Feature-detected at call sites; never used for UA sniffing.
   */
  readonly standalone?: boolean;
}
