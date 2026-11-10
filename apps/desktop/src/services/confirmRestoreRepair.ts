import {confirmDialog} from './productDialog'
/** Confirmation carries no backup identity, path, digest or contents. */
export async function confirmRestoreRepair(assertScope:()=>void){
 assertScope()
 const accepted=await confirmDialog({title:'修复损坏的恢复状态？',message:'无法确认上次使用的备份。请确认已保留原备份和当前本机数据，并选择原始完整备份。继续后将用此文件完成恢复，已有内容保留；全部恢复成功前云同步仍暂停。',confirmText:'修复并继续恢复',tone:'warning'})
 assertScope()
 return accepted
}
