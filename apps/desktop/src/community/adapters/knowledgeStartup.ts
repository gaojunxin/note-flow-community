/** 社区不启动知识后台，也不清理旧档案；旧数据只通过备份保全。 */
export function startKnowledgeImportBackground(_owner:()=>string){return()=>{}}
export async function clearKnowledgeArchives(_scope:string):Promise<void>{}
