import { Inflate } from 'fflate'

export const ZIP_LIMITS = {
  maxInputBytes: 25 * 1024 * 1024,
  maxEntryBytes: 10 * 1024 * 1024,
  maxExpandedBytes: 100 * 1024 * 1024,
  maxFiles: 5000,
}

const TEXT_FILE = /\.(json|md|txt|sql)$/i
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function safePath(name: string): string {
  const parts = name.replace(/\/$/, '').split('/')
  if (!name || name.startsWith('/') || /[\\:]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32) || parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('ZIP に不正なパスがあります')
  }
  return name
}

/** Read a bounded ZIP. Declared sizes alone are not trusted during inflation. */
export async function readCatalogZip(file: Blob): Promise<Map<string, string>> {
  if (file.size > ZIP_LIMITS.maxInputBytes) throw new Error('ZIP の入力サイズが上限を超えています（25MB）')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const requireBytes = (start: number, length: number, end = bytes.length) => {
    if (!Number.isSafeInteger(start) || start < 0 || start + length > end) throw new Error('ZIP のレコード範囲が不正です')
  }
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP の終端レコードが見つかりません')
  const count = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralStart = view.getUint32(eocd + 16, true)
  if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || view.getUint16(eocd + 8, true) !== count || count === 0xffff || centralStart === 0xffffffff || centralStart + centralSize !== eocd) throw new Error('分割 ZIP・ZIP64 または不正な ZIP は未対応です')
  if (count > ZIP_LIMITS.maxFiles) throw new Error('ZIP のファイル数が上限を超えています')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files = new Map<string, string>()
  const names = new Set<string>()
  let pointer = centralStart
  let total = 0
  for (let i = 0; i < count; i += 1) {
    requireBytes(pointer, 46, eocd)
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('ZIP のセントラルディレクトリが壊れています')
    const flags = view.getUint16(pointer + 8, true)
    const method = view.getUint16(pointer + 10, true)
    const crc = view.getUint32(pointer + 16, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const size = view.getUint32(pointer + 24, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const mode = view.getUint32(pointer + 38, true) >>> 16
    const localOffset = view.getUint32(pointer + 42, true)
    requireBytes(pointer, 46 + nameLength + extraLength + commentLength, eocd)
    const name = safePath(decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength)))
    const canonical = name.replace(/\/$/, '').toLowerCase()
    if (names.has(canonical)) throw new Error('ZIP に重複するパスがあります')
    names.add(canonical)
    if (flags & 1 || ![0, 8].includes(method) || view.getUint16(pointer + 34, true) || (mode & 0xf000) === 0xa000) throw new Error('暗号化・リンク・未対応形式の ZIP エントリです')
    if (size > ZIP_LIMITS.maxEntryBytes || total + size > ZIP_LIMITS.maxExpandedBytes) throw new Error('ZIP の展開サイズが上限を超えています')
    requireBytes(localOffset, 30, centralStart)
    if (view.getUint32(localOffset, true) !== 0x04034b50 || view.getUint16(localOffset + 6, true) !== flags || view.getUint16(localOffset + 8, true) !== method) throw new Error('ZIP のローカルヘッダーが不正です')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    requireBytes(localOffset, 30 + localNameLength + localExtraLength + compressedSize, centralStart)
    if (decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name) throw new Error('ZIP のファイル名が一致しません')
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(start, start + compressedSize)
    const chunks: Uint8Array[] = []
    let expanded = 0
    const receive = (chunk: Uint8Array) => {
      expanded += chunk.length
      if (expanded > size || expanded > ZIP_LIMITS.maxEntryBytes || total + expanded > ZIP_LIMITS.maxExpandedBytes) throw new Error('ZIP の実際の展開サイズが上限を超えています')
      chunks.push(chunk)
    }
    if (method === 8) {
      const stream = new Inflate(receive)
      // Small compressed chunks bound transient output before receive can abort.
      for (let offset = 0; offset < raw.length; offset += 1024) stream.push(raw.subarray(offset, offset + 1024), offset + 1024 >= raw.length)
      if (!raw.length) stream.push(raw, true)
    } else receive(raw)
    if (expanded !== size) throw new Error('ZIP の展開サイズが一致しません')
    const data = new Uint8Array(expanded)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
    if (crc32(data) !== crc) throw new Error('ZIP の CRC が一致しません')
    total += expanded
    if (!name.endsWith('/') && TEXT_FILE.test(name) && !name.split('/').includes('__MACOSX')) files.set(name, decoder.decode(data))
    pointer += 46 + nameLength + extraLength + commentLength
  }
  if (pointer !== eocd) throw new Error('ZIP のディレクトリ長が一致しません')
  return files
}
