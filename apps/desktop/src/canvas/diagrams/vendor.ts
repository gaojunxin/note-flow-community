import manifest from './vendor-manifest.json'

export interface DiagramsVendorManifest {
  available:boolean
  version:string
  commit:string
  sha256:string
  entry:string
  license:string
}

export const diagramsVendorManifest=Object.freeze(manifest as DiagramsVendorManifest)
export const isDiagramsVendorAvailable=diagramsVendorManifest.available
export const diagramsVendorEntry=isDiagramsVendorAvailable?diagramsVendorManifest.entry:''
