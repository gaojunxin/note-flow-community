import { defineStore } from 'pinia'
import type { NoteFlowUser } from '@note-flow/core'
import { ensureDesktopProfile, profileUser } from './profiles'

export const useAuthStore = defineStore('auth', {
  state: () => ({ token: '', user: profileUser() as NoteFlowUser | null, initialized: false, initializing: false }),
  getters: { loggedIn: state => Boolean(state.user), syncConnected: () => false },
  actions: {
    clearSession() { this.token = ''; this.user = profileUser() },
    async fetchUser(_migrateServer = false): Promise<NoteFlowUser> { const user = profileUser(); this.user = user; return user },
    async initialize() {
      if (this.initialized || this.initializing) return
      this.initializing = true
      try { this.token = ''; this.user = profileUser(ensureDesktopProfile()); this.initialized = true }
      finally { this.initializing = false }
    },
    async login(_payload: { username: string; password: string; code?: string; uuid?: string }, _options: { migrateServer?: boolean } = {}): Promise<never> {
      throw Object.assign(new Error('社区版无需登录，服务器账号与跨设备同步不可用。本机数据仍可使用。'), { code: 'COMPONENT_UNAVAILABLE' })
    },
    async logout() { this.clearSession() }
  }
})
