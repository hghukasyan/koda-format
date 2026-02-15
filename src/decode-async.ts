/**
 * Non-blocking decode: runs in a worker thread. Uses transferable buffer when possible.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { KodaValue } from './ast.js';
import type { DecodeOptions } from './decoder.js';
import { KodaDecodeError } from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getWorkerURL(): URL {
  const fromModule = join(__dirname, 'worker', 'decoder-worker.js');
  if (existsSync(fromModule)) return pathToFileURL(fromModule);
  const fromDist = join(process.cwd(), 'dist', 'worker', 'decoder-worker.js');
  if (existsSync(fromDist)) return pathToFileURL(fromDist);
  return pathToFileURL(fromModule);
}

let nextId = 0;

export interface DecoderPoolOptions {
  /** Number of worker threads (default 1). */
  poolSize?: number;
}

export interface DecoderPool {
  /** Decode buffer in a worker; does not block the event loop. */
  decode(buffer: Uint8Array, options?: DecodeOptions): Promise<KodaValue>;
  /** Stop all workers. */
  destroy(): void;
}

/**
 * Decode binary in a worker thread. Main thread stays responsive.
 * Uses transferable ArrayBuffer when possible to avoid copy.
 */
export function decodeAsync(buffer: Uint8Array, options?: DecodeOptions): Promise<KodaValue> {
  const id = nextId++;
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return new Promise((resolve, reject) => {
    const worker = new Worker(getWorkerURL(), { workerData: null, eval: false });
    const onMessage = (msg: { id: number; value?: KodaValue; error?: string }) => {
      if (msg.id !== id) return;
      cleanup();
      if ('error' in msg && msg.error) {
        reject(new KodaDecodeError(msg.error));
      } else if ('value' in msg && msg.value !== undefined) {
        resolve(msg.value as KodaValue);
      } else {
        reject(new KodaDecodeError('Worker did not return value'));
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number) => {
      if (code !== 0) {
        cleanup();
        reject(new KodaDecodeError(`Worker exited with code ${code}`));
      }
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      worker.terminate().catch(() => {});
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage({ id, buffer: ab, options }, [ab as ArrayBuffer]);
  });
}

/**
 * Create a pool of decoder workers for high throughput. Decode jobs are
 * distributed round-robin across workers.
 */
export function createDecoderPool(options: DecoderPoolOptions = {}): DecoderPool {
  const poolSize = Math.max(1, options.poolSize ?? 1);
  const workers: Worker[] = [];
  const pendingByWorker: Map<Worker, Map<number, { resolve: (v: KodaValue) => void; reject: (e: Error) => void }>> = new Map();
  let nextIndex = 0;
  let destroyed = false;

  for (let i = 0; i < poolSize; i++) {
    const w = new Worker(getWorkerURL(), { workerData: null, eval: false });
    pendingByWorker.set(w, new Map());
    w.on('message', (msg: { id: number; value?: KodaValue; error?: string }) => {
      const pending = pendingByWorker.get(w)!;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if ('error' in msg && msg.error) {
        entry.reject(new KodaDecodeError(msg.error));
      } else if ('value' in msg && msg.value !== undefined) {
        entry.resolve(msg.value as KodaValue);
      } else {
        entry.reject(new KodaDecodeError('Worker did not return value'));
      }
    });
    workers.push(w);
  }

  function decode(buffer: Uint8Array, options?: DecodeOptions): Promise<KodaValue> {
    if (destroyed) return Promise.reject(new KodaDecodeError('Decoder pool has been destroyed'));
    const id = nextId++;
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    return new Promise((resolve, reject) => {
      const worker = workers[nextIndex % workers.length]!;
      nextIndex++;
      pendingByWorker.get(worker)!.set(id, { resolve, reject });
      worker.postMessage({ id, buffer: ab, options }, [ab as ArrayBuffer]);
    });
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    for (const w of workers) {
      w.terminate().catch(() => {});
    }
    workers.length = 0;
  }

  return { decode, destroy };
}
