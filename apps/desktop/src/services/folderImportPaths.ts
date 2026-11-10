/** Browser and native folder pickers both include the selected folder in the path. */
export function folderImportPathParts(file: Pick<File, 'name' | 'webkitRelativePath'>): string[] {
  const parts = (file.webkitRelativePath || file.name).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length ? parts : [file.name]
}
