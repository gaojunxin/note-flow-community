import { isTauri as detectTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export type PlatformFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const nativeClient = typeof window !== 'undefined'
  && (detectTauri() || window.location.hostname === 'tauri.localhost')

/** Use native HTTP in the desktop client and browser fetch in the web build. */
export const platformFetch: PlatformFetcher = nativeClient
  ? tauriFetch
  : globalThis.fetch.bind(globalThis)
