import { unzipSync } from 'fflate'

export const ZIP_LIMITS = {
  maxInputBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 400 * 1024 * 1024,
  maxFiles: 20000,
}

const TEXT_FILE = /\.(json|md|txt|sql)$/i

/** Read the text members of a catalog ZIP. Binary members are ignored. */
export async function readCatalogZip(file: Blob): Promise<Map<string, string>> {
  if (file.size > ZIP_LIMITS.maxInputBytes) throw new Error(`ZIP が大きすぎます（上限 ${ZIP_LIMITS.maxInputBytes / 1024 / 1024}MB）`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let expanded = 0
  let count = 0
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name.endsWith('/') || !TEXT_FILE.test(entry.name)) return false
      if (entry.name.startsWith('/') || entry.name.split(/[\\/]/).includes('..')) return false
      count += 1
      expanded += entry.originalSize
      if (count > ZIP_LIMITS.maxFiles) throw new Error('ZIP のファイル数が多すぎます')
      if (expanded > ZIP_LIMITS.maxExpandedBytes) throw new Error('ZIP の展開後サイズが大きすぎます')
      return true
    },
  })
  const decoder = new TextDecoder('utf-8')
  const files = new Map<string, string>()
  for (const [path, data] of Object.entries(entries)) {
    if (path.split('/').some((part) => part === '__MACOSX')) continue
    files.set(path.replaceAll('\\', '/'), decoder.decode(data))
  }
  return files
}
