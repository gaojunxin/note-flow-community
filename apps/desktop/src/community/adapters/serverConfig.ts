import {isTauri} from '@tauri-apps/api/core'
export const DESKTOP_SERVER_KEY='note-flow-community-server-unavailable'
export const isDesktopClient=()=>isTauri()
export const getDesktopServerUrl=()=>''
export function normalizeServerUrl(_raw:string):never{throw new Error('社区版本地模式不连接服务器')}
export const setDesktopServerUrl=normalizeServerUrl
