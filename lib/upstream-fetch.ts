import { connectHostname, isIpLiteralHost } from './api-address.ts';

// Cloudflare Workers reject fetch() to an IP literal. The browser never calls the
// provider itself (only same-origin /api/*), so an https page can still reach
// http://IP when this server opens the TCP connection and speaks HTTP/1.1.
// The URL has already been restricted to an API base; callers only request the
// model list and the generation path, and they do not follow redirects.
const MAX_BODY = 2 * 1024 * 1024;
const MAX_HEADERS = 64 * 1024;
const encoder = new TextEncoder();
const CRLF = new Uint8Array([13, 10]);
const HEADER_END = new Uint8Array([13, 10, 13, 10]);

export class UpstreamHttpError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.code = code;
  }
}

const TLS_MESSAGE = '无法与这个 IP 建立 HTTPS。证书必须受信任，并且写明该 IP。中转节点若使用域名证书或自签证书，请改用 http://IP:端口，或改用与证书一致的域名。';

type SocketLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened?: Promise<unknown>;
  close?: () => void | Promise<void>;
};

type ConnectFn = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: 'off' | 'on'; allowHalfOpen?: boolean },
) => SocketLike;

export async function openUpstream(url: URL, init: RequestInit, connectImpl?: ConnectFn | null): Promise<Response> {
  if (!isIpLiteralHost(url.hostname)) return globalThis.fetch(url, init);
  const connect = connectImpl === undefined ? await loadConnect() : connectImpl;
  if (!connect) return globalThis.fetch(url, init);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  let socket: SocketLike | undefined;
  try {
    socket = connect(
      { hostname: connectHostname(url.hostname), port },
      // Half-close so the request FIN does not drop the response still being read.
      { secureTransport: url.protocol === 'https:' ? 'on' : 'off', allowHalfOpen: true },
    );
    if (socket.opened) await socket.opened;
    return await httpExchange(socket, url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (url.protocol === 'https:' && isTlsError(error)) throw new UpstreamHttpError(TLS_MESSAGE, 'TLS_ERROR');
    throw error;
  } finally {
    try { await socket?.close?.(); } catch { /* The response is already buffered. */ }
  }
}

export async function httpExchange(socket: SocketLike, url: URL, init: RequestInit): Promise<Response> {
  const signal = init.signal ?? new AbortController().signal;
  throwIfAborted(signal);
  const payload = bodyBytes(init.body);
  const method = (init.method || 'GET').toUpperCase();
  const head = requestHead(url, method, headerEntries(init.headers), payload ? payload.byteLength : method === 'GET' || method === 'HEAD' ? undefined : 0);
  const writer = socket.writable.getWriter();
  try {
    await writer.write(head);
    if (payload?.byteLength) await writer.write(payload);
    await writer.close();
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  const reader = socket.readable.getReader();
  try {
    return await readResponse(reader, signal);
  } finally {
    reader.releaseLock();
  }
}

async function loadConnect(): Promise<ConnectFn | null> {
  try {
    const mod = await import('cloudflare:sockets');
    return typeof mod.connect === 'function' ? mod.connect as ConnectFn : null;
  } catch {
    return null;
  }
}

function requestHead(url: URL, method: string, headers: [string, string][], bodyLength: number | undefined): Uint8Array {
  const path = `${url.pathname || '/'}${url.search}`;
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${hostHeader(url)}`];
  const skip = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding']);
  for (const [name, value] of headers) {
    if (skip.has(name.toLowerCase())) continue;
    if (/[\r\n:]/.test(name) || /[\r\n]/.test(value)) throw new UpstreamHttpError('请求头无效。', 'BAD_REQUEST');
    lines.push(`${name}: ${value}`);
  }
  lines.push('User-Agent: character-desk', 'Accept-Encoding: identity', 'Connection: close');
  if (bodyLength !== undefined) lines.push(`Content-Length: ${bodyLength}`);
  return encoder.encode(`${lines.join('\r\n')}\r\n\r\n`);
}

function hostHeader(url: URL): string {
  const display = url.hostname.startsWith('[') || !url.hostname.includes(':') ? url.hostname : `[${url.hostname}]`;
  const fallback = url.protocol === 'https:' ? '443' : '80';
  return url.port && url.port !== fallback ? `${display}:${url.port}` : display;
}

function headerEntries(headers: HeadersInit | undefined): [string, string][] {
  if (!headers) return [];
  if (headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers.map(([name, value]) => [String(name), String(value)]);
  return Object.entries(headers).map(([name, value]) => [name, String(value)]);
}

function bodyBytes(body: BodyInit | null | undefined): Uint8Array | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return encoder.encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new UpstreamHttpError('内部请求体类型不受支持。', 'BAD_REQUEST');
}

class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(chunk: Uint8Array) {
    if (!chunk.byteLength) return;
    this.parts.push(chunk);
    this.length += chunk.byteLength;
  }
  private compact() {
    if (this.parts.length <= 1) return;
    const merged = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    this.parts = [merged];
  }
  indexOf(pattern: Uint8Array): number {
    this.compact();
    const buf = this.parts[0];
    if (!buf) return -1;
    outer: for (let i = 0; i <= buf.length - pattern.length; i++) {
      for (let j = 0; j < pattern.length; j++) if (buf[i + j] !== pattern[j]) continue outer;
      return i;
    }
    return -1;
  }
  take(count: number): Uint8Array {
    this.compact();
    const buf = this.parts[0] ?? new Uint8Array();
    const out = buf.slice(0, count);
    this.parts = count >= buf.length ? [] : [buf.subarray(count)];
    this.length -= count;
    return out;
  }
}

async function readResponse(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<Response> {
  const buffered = new Bytes();
  const headerBytes = await readUntil(reader, buffered, signal, HEADER_END, MAX_HEADERS);
  const headerText = new TextDecoder().decode(headerBytes.subarray(0, headerBytes.byteLength - 4));
  const lines = headerText.split('\r\n');
  const status = /^HTTP\/1\.[01] (\d{3})(?:\s|$)/.exec(lines[0] || '');
  if (!status) throw new UpstreamHttpError('服务商返回的不是 HTTP 响应。', 'BAD_UPSTREAM_HTTP');
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new UpstreamHttpError('服务商返回的不是 HTTP 响应。', 'BAD_UPSTREAM_HTTP');
    try {
      headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    } catch {
      throw new UpstreamHttpError('服务商返回的不是 HTTP 响应。', 'BAD_UPSTREAM_HTTP');
    }
  }
  const code = Number(status[1]);
  const body = code === 204 || code === 304 ? null : await readBody(reader, buffered, signal, headers);
  for (const name of ['transfer-encoding', 'content-length', 'connection', 'keep-alive', 'content-encoding']) headers.delete(name);
  return new Response(responseBody(body), { status: code, headers });
}

async function readBody(reader: ReadableStreamDefaultReader<Uint8Array>, buffered: Bytes, signal: AbortSignal, headers: Headers): Promise<Uint8Array> {
  const chunked = headers.get('transfer-encoding')?.split(',').some(part => part.trim().toLowerCase() === 'chunked') ?? false;
  if (chunked) return readChunked(reader, buffered, signal);
  const declared = headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new UpstreamHttpError('服务商返回的不是 HTTP 响应。', 'BAD_UPSTREAM_HTTP');
    const length = Number(declared);
    if (length > MAX_BODY) throw new UpstreamHttpError('服务商响应过大，请减少输出长度。', 'RESPONSE_TOO_LARGE');
    return readExact(reader, buffered, signal, length, length);
  }
  const chunks: Uint8Array[] = [];
  let size = buffered.length;
  if (size) chunks.push(buffered.take(buffered.length));
  while (size <= MAX_BODY) {
    throwIfAborted(signal);
    const next = await reader.read();
    if (next.done) return concat(chunks, size);
    if (!next.value.byteLength) continue;
    size += next.value.byteLength;
    if (size > MAX_BODY) throw new UpstreamHttpError('服务商响应过大，请减少输出长度。', 'RESPONSE_TOO_LARGE');
    chunks.push(next.value);
  }
  throw new UpstreamHttpError('服务商响应过大，请减少输出长度。', 'RESPONSE_TOO_LARGE');
}

async function readChunked(reader: ReadableStreamDefaultReader<Uint8Array>, buffered: Bytes, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const line = await readLine(reader, buffered, signal, 4096);
    const length = Number.parseInt(line.split(';')[0]?.trim() || '', 16);
    if (!/^[0-9a-fA-F]+$/.test(line.split(';')[0]?.trim() || '') || !Number.isFinite(length)) {
      throw new UpstreamHttpError('服务商返回的不是 HTTP 响应。', 'BAD_UPSTREAM_HTTP');
    }
    if (length === 0) {
      while ((await readLine(reader, buffered, signal, 8192)) !== '') { /* trailers */ }
      return concat(chunks, size);
    }
    if (size + length > MAX_BODY) throw new UpstreamHttpError('服务商响应过大，请减少输出长度。', 'RESPONSE_TOO_LARGE');
    chunks.push(await readExact(reader, buffered, signal, length, MAX_BODY));
    const marker = await readExact(reader, buffered, signal, 2, MAX_BODY);
    if (marker[0] !== 13 || marker[1] !== 10) throw new UpstreamHttpError('服务商返回的不是 HTTP 响应。', 'BAD_UPSTREAM_HTTP');
    size += length;
  }
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, buffered: Bytes, signal: AbortSignal, pattern: Uint8Array, max: number): Promise<Uint8Array> {
  while (buffered.indexOf(pattern) < 0) {
    if (buffered.length > max) throw new UpstreamHttpError('服务商响应头过大。', 'RESPONSE_TOO_LARGE');
    throwIfAborted(signal);
    const next = await reader.read();
    if (next.done) throw new UpstreamHttpError('服务商在响应结束前关闭了连接。', 'BAD_UPSTREAM_HTTP');
    buffered.push(next.value);
    if (buffered.indexOf(pattern) < 0 && buffered.length > max) throw new UpstreamHttpError('服务商响应头过大。', 'RESPONSE_TOO_LARGE');
  }
  const index = buffered.indexOf(pattern);
  if (index < 0 || index > max) throw new UpstreamHttpError('服务商响应头过大。', 'RESPONSE_TOO_LARGE');
  return buffered.take(index + pattern.byteLength);
}

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>, buffered: Bytes, signal: AbortSignal, max: number): Promise<string> {
  const bytes = await readUntil(reader, buffered, signal, CRLF, max);
  return new TextDecoder().decode(bytes.subarray(0, bytes.byteLength - 2));
}

async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, buffered: Bytes, signal: AbortSignal, count: number, max: number): Promise<Uint8Array> {
  while (buffered.length < count) {
    if (buffered.length > max) throw new UpstreamHttpError('服务商响应过大，请减少输出长度。', 'RESPONSE_TOO_LARGE');
    throwIfAborted(signal);
    const next = await reader.read();
    if (next.done) throw new UpstreamHttpError('服务商在响应结束前关闭了连接。', 'BAD_UPSTREAM_HTTP');
    buffered.push(next.value);
  }
  return buffered.take(count);
}

function responseBody(body: Uint8Array | null): ArrayBuffer | null {
  if (body === null) return null;
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  return copy;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  const error = new Error('aborted');
  error.name = 'AbortError';
  throw error;
}

function isTlsError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /tls|ssl|certificate|cert|handshake|x509/i.test(message);
}
