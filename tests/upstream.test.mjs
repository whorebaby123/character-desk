import test from 'node:test';
import assert from 'node:assert/strict';
import { httpExchange, openUpstream, UpstreamHttpError } from '../lib/upstream-fetch.ts';

const signal = () => new AbortController().signal;
const enc = new TextEncoder();

function scriptedSocket(response, capture) {
  let controller;
  const readable = new ReadableStream({ start(c) { controller = c; } });
  const received = [];
  const writable = new WritableStream({
    write(chunk) { received.push(chunk); },
    close() {
      capture.request = Buffer.concat(received.map(chunk => Buffer.from(chunk))).toString('utf8');
      for (const part of response) controller.enqueue(enc.encode(part));
      controller.close();
    },
  });
  return { readable, writable, opened: Promise.resolve({}), close() {} };
}

test('IP relay speaks HTTP/1.1 to the literal address and does not follow redirects', async () => {
  const capture = {};
  const body = JSON.stringify({ model: 'proxy-model', messages: [{ role: 'user', content: 'hi' }] });
  const socket = scriptedSocket(['HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{"ok":true}'], capture);
  const response = await httpExchange(socket, new URL('http://1.2.3.4:8080/v1/chat/completions'), {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body,
    signal: signal(),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"ok":true}');
  assert.match(capture.request, /^POST \/v1\/chat\/completions HTTP\/1\.1\r\n/);
  assert.match(capture.request, /Host: 1\.2\.3\.4:8080\r\n/);
  assert.match(capture.request, /Authorization: Bearer secret\r\n/);
  assert.match(capture.request, /Accept-Encoding: identity\r\n/);
  assert.match(capture.request, /Connection: close\r\n/);
  assert.match(capture.request, new RegExp(`Content-Length: ${Buffer.byteLength(body)}\r\n`));
  assert.ok(capture.request.endsWith(`\r\n\r\n${body}`));

  const redirect = {};
  const redirected = scriptedSocket(['HTTP/1.1 302 Found\r\nLocation: http://collector.example/steal\r\nContent-Length: 0\r\n\r\n'], redirect);
  const hop = await httpExchange(redirected, new URL('http://1.2.3.4/v1/models?pageToken=next'), { method: 'GET', headers: { Authorization: 'Bearer secret' }, signal: signal() });
  assert.equal(hop.status, 302);
  assert.equal(hop.headers.get('location'), 'http://collector.example/steal');
  assert.match(redirect.request, /^GET \/v1\/models\?pageToken=next HTTP\/1\.1\r\nHost: 1\.2\.3\.4\r\n/);
  assert.doesNotMatch(redirect.request, /collector\.example/);

  const chunked = scriptedSocket(['HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n', 'b\r\n{"ok":true}\r\n', '0\r\n\r\n'], {});
  assert.equal(await (await httpExchange(chunked, new URL('https://[2606:4700:4700::1111]:8443/v1/models'), { method: 'GET', signal: signal() })).text(), '{"ok":true}');
  const ipv6 = {};
  const v6socket = scriptedSocket(['HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'], ipv6);
  await httpExchange(v6socket, new URL('https://[2606:4700:4700::1111]:8443/v1/models'), { method: 'GET', signal: signal() });
  assert.match(ipv6.request, /Host: \[2606:4700:4700::1111\]:8443\r\n/);

  const huge = scriptedSocket(['HTTP/1.1 200 OK\r\nContent-Length: 3000000\r\n\r\n'], {});
  await assert.rejects(httpExchange(huge, new URL('http://1.2.3.4/v1/models'), { method: 'GET', signal: signal() }), error => error instanceof UpstreamHttpError && error.code === 'RESPONSE_TOO_LARGE');
});

test('Public IP connections use the TCP socket and do not fall back to fetch', async () => {
  const original = globalThis.fetch;
  let fetched = 0;
  const calls = [];
  globalThis.fetch = async () => { fetched += 1; return new Response('no'); };
  try {
    const capture = {};
    const connect = (address, options) => {
      calls.push({ address, options });
      return scriptedSocket(['HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{"ok":true}'], capture);
    };
    const response = await openUpstream(new URL('http://1.2.3.4:8080/v1/models'), { method: 'GET', headers: { Authorization: 'Bearer secret' }, signal: signal() }, connect);
    assert.equal(fetched, 0);
    assert.equal(await response.text(), '{"ok":true}');
    assert.deepEqual(calls[0].address, { hostname: '1.2.3.4', port: 8080 });
    assert.deepEqual(calls[0].options, { secureTransport: 'off', allowHalfOpen: true });
    calls.length = 0;
    await openUpstream(new URL('https://1.2.3.4/v1/models'), { method: 'GET', signal: signal() }, (address, options) => {
      calls.push({ address, options });
      return scriptedSocket(['HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'], {});
    });
    assert.deepEqual(calls[0].address, { hostname: '1.2.3.4', port: 443 });
    assert.equal(calls[0].options.secureTransport, 'on');
    await openUpstream(new URL('http://[2606:4700:4700::1111]:8443/v1'), { method: 'GET', signal: signal() }, (address) => {
      calls.push({ address });
      return scriptedSocket(['HTTP/1.1 204 No Content\r\n\r\n'], {});
    });
    assert.deepEqual(calls.at(-1).address, { hostname: '2606:4700:4700::1111', port: 8443 });
    await assert.rejects(
      openUpstream(new URL('https://1.2.3.4/v1'), { method: 'GET', signal: signal() }, () => { throw Error('TLS handshake failed: certificate verify failed'); }),
      error => error instanceof UpstreamHttpError && error.code === 'TLS_ERROR' && /证书/.test(error.message),
    );
    await assert.rejects(
      openUpstream(new URL('http://1.2.3.4/v1'), { method: 'GET', signal: signal() }, () => { throw Error('connection refused'); }),
      /connection refused/,
    );
    assert.equal(fetched, 0);
    const domain = await openUpstream(new URL('https://api.example.com/v1/models'), { method: 'GET', signal: signal() }, () => { throw Error('should not connect'); });
    assert.equal(fetched, 1);
    assert.equal(await domain.text(), 'no');
  } finally {
    globalThis.fetch = original;
  }
});
