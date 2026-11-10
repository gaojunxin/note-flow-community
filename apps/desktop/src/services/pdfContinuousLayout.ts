export interface PdfPageSize {width:number;height:number}
export interface PdfPageBox extends PdfPageSize {page:number;top:number;scale:number}
export const PDF_PAGE_GAP=16

/** 未读取尺寸的页面先使用首页占位；只创建几何信息，不预先解析或绘制整本PDF。 */
export function pdfContinuousLayout(count:number,sizes:ReadonlyMap<number,PdfPageSize>,fallback:PdfPageSize,width:number,zoom:number,fit:boolean):PdfPageBox[]{
  let top=PDF_PAGE_GAP
  return Array.from({length:count},(_,index)=>{
    const page=index+1,size=sizes.get(page)||fallback
    const scale=fit?Math.max(.25,Math.min(3,(width-2*PDF_PAGE_GAP)/size.width)):zoom
    const box={page,top,scale,width:Math.ceil(size.width*scale),height:Math.ceil(size.height*scale)}
    top+=box.height+PDF_PAGE_GAP
    return box
  })
}

/** 根据滚动位置二分定位页面；页间空隙仍归前页，避免页码在边界来回跳动。 */
export function pdfPageAt(boxes:readonly PdfPageBox[],offset:number){
  let low=0,high=boxes.length-1
  while(low<high){const mid=Math.ceil((low+high)/2);if(boxes[mid].top<=offset)low=mid;else high=mid-1}
  return low
}

/** 画布仅保留可见区域及上下一个视口；长文档的离屏页只占位，不持有像素缓冲。 */
export function pdfVisiblePages(boxes:readonly PdfPageBox[],scrollTop:number,height:number){
  if(!boxes.length)return new Set<number>()
  const first=pdfPageAt(boxes,Math.max(0,scrollTop-height)),last=pdfPageAt(boxes,scrollTop+height*2)
  return new Set(boxes.slice(first,last+1).map(box=>box.page))
}
