export const MINDMAP_SCHEMA = 'note-flow.mindmap'
export const MINDMAP_VERSION = 1 as const

export type MindmapNodeKind = 'root' | 'heading' | 'list-item'

export interface MindmapNodeV1 {
  id: string
  parentId: string | null
  kind: MindmapNodeKind
  text: string
  order: number
  sourceLine?: number
}

export interface MindmapDocumentV1 {
  schema: typeof MINDMAP_SCHEMA
  version: typeof MINDMAP_VERSION
  rootId: string
  nodes: MindmapNodeV1[]
}

export type MindmapDiagnosticCode =
  | 'empty-document'
  | 'heading-level-skip'
  | 'list-indent-jump'
  | 'duplicate-node-id'
  | 'missing-root'
  | 'orphan-node'
  | 'cycle'
  | 'max-depth-exceeded'
  | 'max-nodes-exceeded'

export interface MindmapDiagnostic {
  code: MindmapDiagnosticCode
  severity: 'warning' | 'error'
  message: string
  nodeId?: string
  line?: number
}

export interface MindmapParseResult {
  document: MindmapDocumentV1
  diagnostics: MindmapDiagnostic[]
}

export interface MindmapValidationOptions {
  maxDepth?: number
  maxNodes?: number
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

function nodeId(kind: MindmapNodeKind, structuralPath: number[]): string {
  return `mm-${kind}-${stableHash(`${kind}:${structuralPath.join('.')}`)}`
}

function stripFrontmatter(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return index + 1
  }
  return 0
}

/** Converts Markdown outline structure to the portable mindmap v1 model. */
export function parseMarkdownMindmap(markdown: string, title = '思维导图'): MindmapParseResult {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const root: MindmapNodeV1 = { id: 'mm-root', parentId: null, kind: 'root', text: title.trim() || '思维导图', order: 0 }
  const nodes: MindmapNodeV1[] = [root]
  const diagnostics: MindmapDiagnostic[] = []
  const headingStack: Array<MindmapNodeV1 | undefined> = []
  const listStack: Array<{ indent: number; node: MindmapNodeV1 }> = []
  const childCounts = new Map<string, number>()
  let fencedBy: '`' | '~' | null = null
  let previousHeadingLevel = 0

  const addNode = (kind: MindmapNodeKind, text: string, parent: MindmapNodeV1, line: number): MindmapNodeV1 => {
    const siblingIndex = childCounts.get(parent.id) ?? 0
    childCounts.set(parent.id, siblingIndex + 1)
    const parentPath = (parent as MindmapNodeV1 & { _path?: number[] })._path ?? []
    const path = [...parentPath, siblingIndex]
    const node: MindmapNodeV1 & { _path?: number[] } = {
      id: nodeId(kind, path), parentId: parent.id, kind, text, order: siblingIndex, sourceLine: line, _path: path,
    }
    nodes.push(node)
    return node
  }
  ;(root as MindmapNodeV1 & { _path?: number[] })._path = []

  const contentStart = stripFrontmatter(lines)
  for (let index = contentStart; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1][0] as '`' | '~'
      if (fencedBy === null) fencedBy = marker
      else if (fencedBy === marker) fencedBy = null
      continue
    }
    if (fencedBy) continue

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1].length
      if (previousHeadingLevel && level > previousHeadingLevel + 1) {
        diagnostics.push({ code: 'heading-level-skip', severity: 'warning', line: index + 1, message: `标题从 H${previousHeadingLevel} 跳到 H${level}` })
      }
      const parent = [...headingStack.slice(0, level - 1)].reverse().find(Boolean) ?? root
      const node = addNode('heading', heading[2].trim(), parent, index + 1)
      headingStack[level - 1] = node
      headingStack.length = level
      listStack.length = 0
      previousHeadingLevel = level
      continue
    }

    const listItem = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/)
    if (!listItem) continue
    const indent = listItem[1].replace(/\t/g, '    ').length
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop()
    if (listStack.length && indent > listStack[listStack.length - 1].indent + 4) {
      diagnostics.push({ code: 'list-indent-jump', severity: 'warning', line: index + 1, message: '列表缩进跨越超过一级，已挂到最近父节点' })
    }
    const headingParent = [...headingStack].reverse().find(Boolean) ?? root
    const parent = listStack[listStack.length - 1]?.node ?? headingParent
    const node = addNode('list-item', listItem[2].trim(), parent, index + 1)
    listStack.push({ indent, node })
  }

  for (const node of nodes) delete (node as MindmapNodeV1 & { _path?: number[] })._path
  if (nodes.length === 1) diagnostics.push({ code: 'empty-document', severity: 'warning', message: 'Markdown 中没有可生成脑图的标题或列表' })
  diagnostics.push(...validateMindmapDocument({ schema: MINDMAP_SCHEMA, version: MINDMAP_VERSION, rootId: root.id, nodes }))
  return { document: { schema: MINDMAP_SCHEMA, version: MINDMAP_VERSION, rootId: root.id, nodes }, diagnostics }
}

export function validateMindmapDocument(document: MindmapDocumentV1, options: MindmapValidationOptions = {}): MindmapDiagnostic[] {
  const maxDepth = options.maxDepth ?? 64
  const maxNodes = options.maxNodes ?? 10_000
  const diagnostics: MindmapDiagnostic[] = []
  const byId = new Map<string, MindmapNodeV1>()
  for (const node of document.nodes) {
    if (byId.has(node.id)) diagnostics.push({ code: 'duplicate-node-id', severity: 'error', nodeId: node.id, message: `节点 ID 重复：${node.id}` })
    else byId.set(node.id, node)
  }
  if (!byId.has(document.rootId)) diagnostics.push({ code: 'missing-root', severity: 'error', nodeId: document.rootId, message: '根节点不存在' })
  if (document.nodes.length > maxNodes) diagnostics.push({ code: 'max-nodes-exceeded', severity: 'error', message: `节点数 ${document.nodes.length} 超过限制 ${maxNodes}` })
  for (const node of document.nodes) {
    if (node.id !== document.rootId && (!node.parentId || !byId.has(node.parentId))) {
      diagnostics.push({ code: 'orphan-node', severity: 'error', nodeId: node.id, message: `节点 ${node.id} 的父节点不存在` })
    }
    const seen = new Set<string>()
    let cursor: MindmapNodeV1 | undefined = node
    let depth = 0
    let depthReported = false
    while (cursor?.parentId) {
      if (seen.has(cursor.id)) {
        diagnostics.push({ code: 'cycle', severity: 'error', nodeId: node.id, message: `节点 ${node.id} 位于环中` })
        break
      }
      seen.add(cursor.id)
      depth += 1
      if (depth > maxDepth && !depthReported) {
        diagnostics.push({ code: 'max-depth-exceeded', severity: 'error', nodeId: node.id, message: `节点 ${node.id} 深度超过限制 ${maxDepth}` })
        depthReported = true
      }
      cursor = byId.get(cursor.parentId)
    }
  }
  return diagnostics
}
