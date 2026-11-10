/** Keep diagnostic history bounded even during multi-day sessions. */
export function appendBounded<T>(items:T[],item:T,limit=500){
  items.push(item)
  if(items.length>limit)items.splice(0,items.length-limit)
}
