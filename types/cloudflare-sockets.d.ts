interface CharacterDeskSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened?: Promise<unknown>;
  close?: () => void | Promise<void>;
}

declare module 'cloudflare:sockets' {
  export function connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: 'off' | 'on'; allowHalfOpen?: boolean },
  ): CharacterDeskSocket;
}
