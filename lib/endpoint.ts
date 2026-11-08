import { validateApiEndpoint } from './api-address.ts';

export function endpoint(input: string): URL {
  const url = validateApiEndpoint(input);
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url;
}
