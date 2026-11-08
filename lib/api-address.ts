// User-configured provider URLs are fetched by this deployment, not by the browser.
// Allow public http(s) endpoints, including IP literals and non-default ports.
// Private, loopback, link-local and metadata targets stay blocked so the public
// site cannot be used as an open proxy into those networks. Self-hosters who
// intentionally share a network with the proxy can set ALLOW_PRIVATE_API_HOSTS=1.
const INVALID = '请输入有效的 API 地址。';
const SHAPE = 'API 地址只支持 http 或 https，且不能包含账号、查询参数或片段。密钥请填在 Key 栏，不要写进地址。';
const PORT = 'API 端口必须是 1–65535。';
const PRIVATE = '该地址位于内网或本机，公开站点到不了。请改用公网 IP 或域名，例如 http://1.2.3.4:端口/v1。自行部署并只在可信网络使用时，可设置环境变量 ALLOW_PRIVATE_API_HOSTS=1（169.254.169.254、链路本地和其它保留地址仍然拒绝）。';
const RESERVED = '该地址属于保留网段、组播或云元数据地址，不能作为 API 地址。';
const SINGLE = '请使用公网域名或 IP，不要使用单标签主机名。';

type Kind = 'public' | 'private' | 'reserved' | 'domain';

export function allowPrivateApiHosts(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const value = env?.ALLOW_PRIVATE_API_HOSTS;
    return typeof value === 'string' && /^(1|true|yes)$/i.test(value.trim());
  } catch {
    return false;
  }
}

export function validateApiEndpoint(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw Error(INVALID);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Error(SHAPE);
  if (url.username || url.password || url.search || url.hash) throw Error(SHAPE);
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error(PORT);
  }
  const inspected = inspectHost(url.hostname);
  if (inspected.kind === 'reserved') throw Error(RESERVED);
  if (inspected.kind === 'private' && !allowPrivateApiHosts()) throw Error(PRIVATE);
  if (inspected.kind === 'domain') assertDomain(url.hostname);
  if (inspected.rewrite) url.hostname = inspected.rewrite;
  return url;
}

export function isIpLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') || host.includes(':')) return true;
  return parseIPv4(host) !== null;
}

export function connectHostname(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function inspectHost(hostname: string): { kind: Kind; rewrite?: string } {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const ipv4 = parseIPv4(host);
  if (ipv4 !== null) return { kind: classifyIPv4(ipv4) };
  if (host.startsWith('[') || host.includes(':')) {
    const groups = parseIPv6(host);
    if (!groups) throw Error(INVALID);
    const embedded = embeddedIPv4(groups);
    const kind = embedded === null ? classifyIPv6(groups) : classifyIPv4(embedded);
    if (embedded !== null && isDirectIPv4Embedding(groups)) return { kind, rewrite: ipv4ToString(embedded) };
    return { kind };
  }
  if (/^[\d.]+$/.test(host)) throw Error(INVALID);
  return { kind: 'domain' };
}

function assertDomain(hostname: string): void {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  const labels = name.split('.');
  if (!name || labels.some(label => label.length === 0 || label.length > 63)) throw Error(INVALID);
  if (name === 'metadata.google.internal' || name.endsWith('.metadata.google.internal')) throw Error(RESERVED);
  if (/(^|\.)(test|invalid)$/.test(name)) throw Error(RESERVED);
  const internalName = name === 'localhost' || /(^|\.)(localhost|local|internal)$/.test(name);
  if (internalName) {
    if (!allowPrivateApiHosts()) throw Error(PRIVATE);
    return;
  }
  if (!name.includes('.')) throw Error(SINGLE);
}

function classifyIPv4(ip: number): Kind {
  const reserved: [number, number][] = [
    [0x00000000, 8],
    [0x64400000, 10],
    [0xa9fe0000, 16],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 4],
    [0xf0000000, 4],
  ];
  for (const [base, bits] of reserved) if (inCidr(ip, base, bits)) return 'reserved';
  const privateNets: [number, number][] = [
    [0x0a000000, 8],
    [0x7f000000, 8],
    [0xac100000, 12],
    [0xc0a80000, 16],
  ];
  for (const [base, bits] of privateNets) if (inCidr(ip, base, bits)) return 'private';
  return 'public';
}

function classifyIPv6(groups: number[]): Kind {
  if (groups.every(part => part === 0)) return 'reserved';
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return 'private';
  if ((groups[0] & 0xfe00) === 0xfc00) return 'private';
  if ((groups[0] & 0xffc0) === 0xfec0) return 'private';
  if ((groups[0] & 0xffc0) === 0xfe80) return 'reserved';
  if ((groups[0] & 0xff00) === 0xff00) return 'reserved';
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return 'reserved';
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return 'reserved';
  if (groups[0] === 0x2001 && groups[1] === 0x0002) return 'reserved';
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && (groups[2] & 0xff00) === 0x0100) return 'private';
  return 'public';
}

// IPv4-mapped (::ffff:0:0/96) and deprecated IPv4-compatible (::/96) addresses
// are the same host as the embedded IPv4. NAT64 and 6to4 are classified by the
// embedded address too, but they are not rewritten: the packet destination differs.
function isDirectIPv4Embedding(groups: number[]): boolean {
  const leadingZero = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0;
  return leadingZero && (groups[5] === 0xffff || groups[5] === 0);
}

function embeddedIPv4(groups: number[]): number | null {
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return ((groups[6] << 16) | groups[7]) >>> 0;
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return ((groups[6] << 16) | groups[7]) >>> 0;
  }
  if (groups[0] === 0x2002) return ((groups[1] << 16) | groups[2]) >>> 0;
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    const value = ((groups[6] << 16) | groups[7]) >>> 0;
    if (value > 1) return value;
  }
  return null;
}

function parseIPv4(host: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = [1, 2, 3, 4].map(index => Number(match[index]));
  if (parts.some(part => part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function parseIPv6(raw: string): number[] | null {
  let host = raw.toLowerCase();
  if (host.startsWith('[')) {
    if (!host.endsWith(']')) return null;
    host = host.slice(1, -1);
  }
  if (!host || host.includes('%')) return null;
  const lastColon = host.lastIndexOf(':');
  const tail = lastColon >= 0 ? host.slice(lastColon + 1) : host;
  if (tail.includes('.')) {
    const ipv4 = parseIPv4(tail);
    if (ipv4 === null || lastColon < 0) return null;
    host = `${host.slice(0, lastColon + 1)}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const parts = side.split(':');
    if (parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
    return parts.map(part => Number.parseInt(part, 16));
  };
  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseSide(halves[1]);
  if (!right) return null;
  const zeros = 8 - left.length - right.length;
  if (zeros < 1) return null;
  return [...left, ...Array<number>(zeros).fill(0), ...right];
}

function inCidr(ip: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base >>> 0 & mask);
}

function ipv4ToString(ip: number): string {
  return [(ip >>> 24) & 255, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.');
}
