/** PDF内置大纲的展示项；只保留文档内目的地，不执行外部链接、脚本或附件动作。 */
export interface PdfOutlineEntry { id:number; title:string; depth:number; dest:unknown }
interface OutlineDocument {
 numPages:number
 getOutline():Promise<any[]|null>
 getDestination(name:string):Promise<any[]|null>
 getPageIndex(ref:any):Promise<number>
}
/** 大纲读取失败由调用方单独提示，不应使已加载的PDF正文失败。 */
export async function readPdfOutline(pdf:OutlineDocument):Promise<PdfOutlineEntry[]> {
 const source=await pdf.getOutline(),result:PdfOutlineEntry[]=[],stack=(source||[]).slice().reverse().map(item=>({item,depth:0}))
 // 非递归遍历避免深层目录耗尽调用栈；限制异常文件的展示规模。
 while(stack.length&&result.length<10000){
  const {item,depth}=stack.pop()!;if(!item||typeof item!=='object')continue
  result.push({id:result.length,title:typeof item.title==='string'&&item.title.trim()?item.title.trim():'未命名章节',depth,dest:item.dest})
  if(Array.isArray(item.items))for(let i=item.items.length-1;i>=0;i--)stack.push({item:item.items[i],depth:depth+1})
 }
 return result
}
/** 按点击时解析命名目的地或页引用；页码使用1起算，无效目标拒绝且不改变当前位置。 */
export async function resolvePdfOutline(pdf:OutlineDocument,destination:unknown):Promise<{page:number;top:number|null;left:number|null}> {
 const dest=typeof destination==='string'?await pdf.getDestination(destination):destination
 if(!Array.isArray(dest)||dest.length<2)throw new Error('此目录项没有可用的文档内位置')
 const index=typeof dest[0]==='number'?dest[0]:dest[0]&&typeof dest[0]==='object'?await pdf.getPageIndex(dest[0]):-1
 if(!Number.isInteger(index)||index<0||index>=pdf.numPages)throw new Error('此目录项的目标页无效')
 const kind=dest[1]?.name,number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null
 return {page:index+1,top:number(kind==='XYZ'?dest[3]:kind==='FitH'||kind==='FitBH'?dest[2]:kind==='FitR'?dest[5]:null),left:number(kind==='XYZ'||kind==='FitR'?dest[2]:null)}
}
