const names=new Intl.Collator('zh-CN',{numeric:true})
/** Presentation only: numeric name segments (01, 02, 10) compare as numbers. */
export const compareNaturalNames=(left?:string|null,right?:string|null)=>names.compare(left||'',right||'')
export function compareOrderedNames(left:{name?:string|null;sortOrder?:number},right:{name?:string|null;sortOrder?:number}){
 const rank=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0
 // Numeric prefixes are the user's explicit name order. Imported/server ranks
 // must not override 01/02/03; unnumbered siblings keep their existing ranks.
 const numbered=(name?:string|null)=>/^\s*\d/.test(name||'')
 const a=numbered(left.name),b=numbered(right.name)
 if(a!==b)return a?-1:1
 return a
  ?compareNaturalNames(left.name,right.name)||rank(left.sortOrder)-rank(right.sortOrder)
  :rank(left.sortOrder)-rank(right.sortOrder)||compareNaturalNames(left.name,right.name)
}
