const release = {"version":"0.12.18","versionCode":12018,"channel":"development"} as const

/** Bundled at build time so an installed client reports its own release. */
export const appInfo = Object.freeze({
  version: release.version,
  versionCode: release.versionCode,
  channel: release.channel,
  versionLabel: `v${release.version}`,
})
