/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set (to any value) to run the UI against the in-memory fake core instead of Tauri. */
  readonly VITE_FAKE_CORE?: string;
}
