import {appLock} from './appLock'
import {accountLifecycleRevision} from './accountStorage'
import {clientOwnerScope} from './clientContext'
/** Captures no file contents or credentials. Valid through encoding/provider completion. */
export function captureFileExportBoundary(){
 if(appLock.locked.value)throw Error('软件已锁定，已取消文件导出')
 const lock=appLock.revision(),lifecycle=accountLifecycleRevision(),scope=clientOwnerScope('local')
 return()=>{if(appLock.locked.value||lock!==appLock.revision()||lifecycle!==accountLifecycleRevision()||scope!==clientOwnerScope('local'))throw Error('账号、空间或软件锁状态已变化，已取消文件导出')}
}
