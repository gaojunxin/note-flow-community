/** Independent overlays must not restore an inert value captured from another overlay. */
const leases=new WeakMap<HTMLElement,{original:boolean;owners:Set<symbol>}>()
export function acquireInert(element:HTMLElement|null):()=>void{
 if(!element)return()=>{}
 let state=leases.get(element)
 if(!state){state={original:element.inert,owners:new Set()};leases.set(element,state)}
 const owner=Symbol('inert-owner');state.owners.add(owner);element.inert=true
 return()=>{
  if(!state!.owners.delete(owner))return
  if(state!.owners.size){element.inert=true;return}
  element.inert=state!.original;leases.delete(element)
 }
}
