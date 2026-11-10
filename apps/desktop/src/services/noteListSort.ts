const titleCollator=new Intl.Collator('zh-CN',{numeric:true})
/** Chapter numbers in titles sort by value, including zero-padded prefixes. */
export const compareNoteTitles=(left?:string|null,right?:string|null)=>titleCollator.compare(left||'',right||'')
