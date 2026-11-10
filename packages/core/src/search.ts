export const SEARCH_QUERY_MAX_LENGTH = 100
export const SEARCH_PAGE_MAX_SIZE = 50

export interface SearchPageRequest {
  query: string
  page: number
  size: number
  offset: number
}

export interface SearchPage<T> {
  items: T[]
  total: number
  page: number
  size: number
  hasMore: boolean
}

export function normalizeSearchQuery(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[`*_>#\[\](){}!|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_MAX_LENGTH)
}

export function normalizeSearchPageRequest(query: unknown, requestedPage = 1, requestedSize = 20, maximumSize = SEARCH_PAGE_MAX_SIZE): SearchPageRequest {
  const page = Math.max(1, Math.trunc(Number(requestedPage)) || 1)
  const ceiling = Math.max(1, Math.trunc(Number(maximumSize)) || SEARCH_PAGE_MAX_SIZE)
  const size = Math.max(1, Math.min(ceiling, Math.trunc(Number(requestedSize)) || 20))
  return { query: normalizeSearchQuery(query), page, size, offset: (page - 1) * size }
}

export function createSearchPage<T>(items: T[], total: number, page: number, size: number): SearchPage<T> {
  const safeTotal = Math.max(0, Math.trunc(Number(total)) || 0)
  return { items, total: safeTotal, page, size, hasMore: (page - 1) * size + items.length < safeTotal }
}

export function searchPageMetadataEqual<T>(left: SearchPage<T>, right: SearchPage<T>): boolean {
  return left.total === right.total && left.page === right.page && left.size === right.size && left.hasMore === right.hasMore
}
