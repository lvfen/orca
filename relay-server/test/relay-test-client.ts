import { WebSocket, type RawData } from 'ws'

export type ReceivedMessage = { text?: string; binary?: Buffer }
export type CloseInfo = { code: number; reason: string }

// Why: a tiny promise-based WebSocket wrapper so the end-to-end tests can drive
// two real `ws` clients (host + phone) against the relay and assert ordered
// control frames, forwarded payloads, and close codes.
export class RelayTestClient {
  readonly ws: WebSocket
  private readonly queue: ReceivedMessage[] = []
  private readonly waiters: ((m: ReceivedMessage) => void)[] = []
  private closeInfo: CloseInfo | null = null
  private readonly closeWaiters: ((info: CloseInfo) => void)[] = []

  constructor(url: string) {
    this.ws = new WebSocket(url)
    // Why: swallow late socket errors so an abrupt termination after a test's
    // assertions does not throw an unhandled 'error' event.
    this.ws.on('error', () => {})
    this.ws.on('message', (data: RawData, isBinary: boolean) => {
      const message: ReceivedMessage = isBinary
        ? { binary: toBuffer(data) }
        : { text: toBuffer(data).toString('utf-8') }
      const waiter = this.waiters.shift()
      if (waiter) {
        waiter(message)
        return
      }
      this.queue.push(message)
    })
    this.ws.on('close', (code: number, reason: Buffer) => {
      this.closeInfo = { code, reason: reason.toString('utf-8') }
      for (const waiter of this.closeWaiters.splice(0)) {
        waiter(this.closeInfo)
      }
    })
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
    })
  }

  send(data: string | Buffer): void {
    this.ws.send(data)
  }

  nextMessage(timeoutMs = 3_000): Promise<ReceivedMessage> {
    const queued = this.queue.shift()
    if (queued) {
      return Promise.resolve(queued)
    }
    return new Promise((resolve, reject) => {
      const onMessage = (m: ReceivedMessage): void => {
        clearTimeout(timer)
        resolve(m)
      }
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onMessage)
        if (index >= 0) {
          this.waiters.splice(index, 1)
        }
        reject(new Error('Timed out waiting for message'))
      }, timeoutMs)
      this.waiters.push(onMessage)
    })
  }

  async nextJson(): Promise<unknown> {
    const message = await this.nextMessage()
    if (message.text === undefined) {
      throw new Error('Expected a text frame but received binary')
    }
    return JSON.parse(message.text)
  }

  waitClose(timeoutMs = 3_000): Promise<CloseInfo> {
    if (this.closeInfo) {
      return Promise.resolve(this.closeInfo)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeoutMs)
      this.closeWaiters.push((info) => {
        clearTimeout(timer)
        resolve(info)
      })
    })
  }

  close(): void {
    this.ws.close()
  }
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }
  return data as Buffer
}
