/**
 * Git blob SHA-1 ("blob <byteLength>\0<content>"), identical to what GitHub returns.
 * Lets us content-address local writes (optimistic UI, cache) before they reach GitHub.
 */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content)
  const header = new TextEncoder().encode(`blob ${body.length}\0`)
  const buf = new Uint8Array(header.length + body.length)
  buf.set(header)
  buf.set(body, header.length)
  const digest = await crypto.subtle.digest('SHA-1', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
