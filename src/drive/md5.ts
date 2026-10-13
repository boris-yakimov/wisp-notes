import SparkMD5 from 'spark-md5'

/** MD5 of the UTF-8 bytes of `text`, hex. Matches Drive's `md5Checksum` for the uploaded file. */
export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return SparkMD5.ArrayBuffer.hash(bytes.buffer as ArrayBuffer)
}

export const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e'

/** Decode file bytes as UTF-8 without stripping a BOM, so md5(decoded) matches the file when valid UTF-8. */
export function decodeUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf)
}
