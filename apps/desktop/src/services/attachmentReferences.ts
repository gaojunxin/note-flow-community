export type AttachmentReferenceKind = 'private_attachment' | 'data' | 'local' | 'remote'

export interface MarkdownImageReference {
  raw: string
  alt: string
  url: string
  kind: AttachmentReferenceKind
  host?: string
  start: number
  end: number
}

const markdownImagePattern = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g

export function classifyImageUrl(value: string): { kind: AttachmentReferenceKind; host?: string } {
  if (/^data:image\//i.test(value)) return { kind: 'data' }
  if (/^(?:https?:)?\/\/[^/]+/i.test(value)) {
    try {
      const parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
      return { kind: 'remote', host: parsed.hostname.toLowerCase() }
    } catch { return { kind: 'remote' } }
  }
  if (/^\/api\/v1\/attachments\/[^/]+\/content(?:\?.*)?$/i.test(value)) return { kind: 'private_attachment' }
  return { kind: 'local' }
}

export function findMarkdownImages(markdown: string): MarkdownImageReference[] {
  const result: MarkdownImageReference[] = []
  for (const match of markdown.matchAll(markdownImagePattern)) {
    const raw = match[0], url = match[2] || match[3] || '', start = match.index || 0
    result.push({ raw, alt: match[1] || '', url, ...classifyImageUrl(url), start, end: start + raw.length })
  }
  return result
}

export function replaceMarkdownImage(markdown: string, reference: MarkdownImageReference, nextUrl: string) {
  if (!nextUrl.trim()) throw new Error('图片地址不能为空')
  const next = `![${reference.alt}](${nextUrl.trim()})`
  return markdown.slice(0, reference.start) + next + markdown.slice(reference.end)
}
