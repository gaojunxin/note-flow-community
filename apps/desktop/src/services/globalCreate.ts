let pendingFileItems: File[] = []

export function selectGlobalCreateFiles() {
  return new Promise<File[]>(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.hidden = true
    const finish = (files:File[]) => {input.remove();resolve(files)}
    input.onchange = () => finish([...(input.files || [])])
    input.oncancel = () => finish([])
    document.body.appendChild(input)
    input.click()
  })
}

export function stageGlobalCreateFiles(files: File[]) { pendingFileItems = files }
export function consumeGlobalCreateFiles() { const files = pendingFileItems; pendingFileItems = []; return files }
