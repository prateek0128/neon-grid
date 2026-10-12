import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { ServerMessage } from '@neon/protocol';
// In-memory HTTP session; no network socket, upgrades, or subscriptions.
export class HttpPeer extends EventEmitter {
  static OPEN = 1; static CLOSED = 3;
  readyState = HttpPeer.OPEN; bufferedAmount = 0; lastSeen = performance.now(); busy = false;
  accepted = new Map<number, string>();
  handler: (raw: string, binary: boolean) => Promise<void> = async () => {};
  private messages: ServerMessage[] = [];
  send(raw: string) {
    const message = JSON.parse(raw) as ServerMessage;
    if (message.type === 'snapshot') return; // State is fetched on demand, never buffered per simulation tick.
    this.messages.push(message);
    if (this.messages.length > 32) this.messages.shift();
  }
  drain() { return this.messages.splice(0); }
  dispatch(raw: string) { return this.handler(raw, false); }
  close(code = 1000, _reason?: string) {
    if (this.readyState === HttpPeer.CLOSED) return;
    this.readyState = HttpPeer.CLOSED; this.emit('close', code);
  }
  terminate() { this.close(); }
}
