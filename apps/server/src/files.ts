import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/** Read `length` bytes of a file from `start` (clamped to its size). */
function readRange(file: string, start: number, length: number): { text: string; size: number } {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const from = Math.max(0, Math.min(start, size))
    const n = Math.max(0, Math.min(length, size - from))
    const buf = Buffer.alloc(n)
    readSync(fd, buf, 0, n, from)
    return { text: buf.toString('utf8'), size }
  } finally {
    closeSync(fd)
  }
}

export const readHead = (file: string, bytes: number) => readRange(file, 0, bytes).text

/** Last complete lines of a file, within the last `bytes` bytes. */
export function readTailLines(file: string, bytes: number): string[] {
  const { size } = readRange(file, Number.MAX_SAFE_INTEGER, 0)
  const tail = readRange(file, size - bytes, bytes).text
  const lines = tail.split('\n')
  if (size > bytes) lines.shift() // first line is probably cut
  return lines.filter(Boolean)
}

/** Complete lines appended since `offset`; returns the new offset (end of the last complete line). */
export function readNewLines(file: string, offset: number): { lines: string[]; offset: number } {
  const { text } = readRange(file, offset, 64 * 1024 * 1024)
  const end = text.lastIndexOf('\n')
  if (end < 0) return { lines: [], offset }
  const chunk = text.slice(0, end)
  return { lines: chunk.split('\n').filter(Boolean), offset: offset + Buffer.byteLength(chunk, 'utf8') + 1 }
}
