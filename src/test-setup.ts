/**
 * jsdom implements Blob but not the object-URL registry, which the EPUB parser
 * uses to render embedded images. Provide a minimal stand-in.
 */
let counter = 0
const registry = new Map<string, Blob>()

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = (object: Blob | MediaSource): string => {
    const url = `blob:test://object/${++counter}`
    registry.set(url, object as Blob)
    return url
  }
  URL.revokeObjectURL = (url: string): void => {
    registry.delete(url)
  }
}

export function objectUrlCount(): number {
  return registry.size
}
