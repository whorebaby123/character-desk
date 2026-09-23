export function endpoint(input: string): URL {
    let url: URL;
    try {
        url = new URL(input.trim());
    }
    catch {
        throw Error('请输入有效的 API 地址。');
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443')
        throw Error('API 地址需为不含账号、查询参数的 HTTPS 地址（443 端口）。');
    if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host.endsWith('.localhost'))
        throw Error('请使用公网 API 域名。');
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (!url.pathname.endsWith('/chat/completions'))
        url.pathname += '/chat/completions';
    return url;
}
