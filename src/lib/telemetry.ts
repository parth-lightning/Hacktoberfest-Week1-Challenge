export type NetworkUsage = { sentBytes: number; receivedBytes: number };

const usage: NetworkUsage = { sentBytes: 0, receivedBytes: 0 };
const listeners = new Set<(value: NetworkUsage) => void>();

function publish(): void {
  const current = { ...usage };
  for (const listener of listeners) listener(current);
}

function isExternalNetworkRequest(input: RequestInfo | URL): boolean {
  const requestUrl = typeof input === "string" || input instanceof URL
    ? new URL(input, location.href)
    : new URL(input.url);
  return !(
    ["localhost", "127.0.0.1", "::1"].includes(requestUrl.hostname)
  );
}

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const external = isExternalNetworkRequest(input);
  const bodyBytes = typeof init?.body === "string"
    ? new TextEncoder().encode(init.body).byteLength
    : init?.body instanceof Blob
      ? init.body.size
      : init?.body instanceof ArrayBuffer
        ? init.body.byteLength
        : 0;
  const response = await fetch(input, init);
  if (external) {
    usage.sentBytes += bodyBytes;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    usage.receivedBytes += Number.isFinite(contentLength) ? contentLength : 0;
    publish();
  }
  return response;
}

export function getNetworkUsage(): NetworkUsage {
  return { ...usage };
}

export function subscribeNetworkUsage(
  listener: (value: NetworkUsage) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetNetworkUsage(): void {
  usage.sentBytes = 0;
  usage.receivedBytes = 0;
  publish();
}
