/** LAN HTTP previews may not expose navigator.clipboard. Keep copying available there. */
export async function copyLearningText(text:string):Promise<void>{
 try{if(navigator.clipboard){await navigator.clipboard.writeText(text);return}}catch{/* Fall back to a user-initiated selection copy. */}
 const previous=document.activeElement as HTMLElement|null,selection=document.getSelection(),ranges=selection?Array.from({length:selection.rangeCount},(_,index)=>selection.getRangeAt(index).cloneRange()):[]
 const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';document.body.appendChild(area)
 try{area.select();if(!document.execCommand('copy'))throw Error('无法访问剪贴板，请选择正文复制')}finally{area.remove();previous?.focus({preventScroll:true});if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range)}}
}
