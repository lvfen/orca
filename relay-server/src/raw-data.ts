import type { RawData } from 'ws'

// Why: only the FIRST frame (the join control frame) is ever decoded as text;
// every later frame is opaque E2EE ciphertext forwarded verbatim. This decodes
// the join frame across the shapes `ws` hands us (string, Buffer, Buffer[],
// ArrayBuffer).
export function rawDataToString(data: RawData): string {
  if (typeof data === 'string') {
    return data
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf-8')
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf-8')
  }
  return data.toString('utf-8')
}

// Why: byte length of a forwarded frame for the forwardedBytes metric, without
// copying or decoding the (opaque) payload.
export function rawDataByteLength(data: RawData): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data)
  }
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.length, 0)
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength
  }
  return data.length
}
