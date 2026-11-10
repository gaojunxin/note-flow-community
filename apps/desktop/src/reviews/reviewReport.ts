const START='<!-- nf:generated:start -->', END='<!-- nf:generated:end -->'

export function managedReviewBlock(markdown='') {
  const start=markdown.indexOf(START),end=markdown.indexOf(END)
  if(start<0||end<start)return''
  return markdown.slice(start+START.length,end).trim()
}

export function autonomousReviewContent(markdown='') {
  const start=markdown.indexOf(START),end=markdown.indexOf(END)
  if(start<0||end<start)return markdown.trim()
  return `${markdown.slice(0,start).trim()}\n\n${markdown.slice(end+END.length).trim()}`.trim()
}

export function replaceAutonomousReviewContent(markdown='',autonomous='') {
  const generated=managedReviewBlock(markdown)
  return `${autonomous.trim()}\n\n${START}\n${generated}\n${END}\n`.trim()
}

export function reviewGenerationDiff(before='',after='') {
  const previous=managedReviewBlock(before),next=managedReviewBlock(after)
  return {previous,next,changed:previous!==next}
}

export function extractReviewPlanTasks(markdown='') {
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n'),start=lines.findIndex(line=>/^##\s+下期计划\s*$/.test(line.trim()))
  if(start<0)return[]
  const seen=new Set<string>(),result:string[]=[]
  for(const line of lines.slice(start+1)){if(/^##\s+/.test(line.trim()))break;const match=line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s*)?(.+?)\s*$/);if(!match||String(match[1]||'').toLowerCase()==='x')continue;const title=match[2].replace(/<!--.*?-->/g,'').trim();if(title&&!seen.has(title)){seen.add(title);result.push(title)}}
  return result
}
