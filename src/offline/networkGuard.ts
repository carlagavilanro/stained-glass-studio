export type BlockedNetworkHandler = (url: string) => void;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isLocalOrEmbeddedUrl(rawUrl: string): boolean {
  if (!rawUrl.trim()) return true;

  try {
    const url = new URL(rawUrl, window.location.href);
    if (url.protocol === "blob:" || url.protocol === "data:" || url.protocol === "file:") return true;
    if (url.origin === window.location.origin) return true;
    if (LOCAL_HOSTNAMES.has(url.hostname)) return true;
    return false;
  } catch {
    // Relative or browser-internal URLs should not be treated as remote cloud calls.
    return true;
  }
}

function urlFromFetchInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function shouldBlockNetworkUrl(rawUrl: string): boolean {
  return !isLocalOrEmbeddedUrl(rawUrl);
}

export function installOfflineNetworkGuard(onBlocked?: BlockedNetworkHandler): void {
  if (typeof window === "undefined") return;
  const marker = "__stainedGlassOfflineGuardInstalled";
  const guardedWindow = window as unknown as Window & Record<string, unknown>;
  if (guardedWindow[marker]) return;
  guardedWindow[marker] = true;

  const block = (rawUrl: string): never => {
    onBlocked?.(rawUrl);
    throw new Error(`Offline mode blocked a non-local network request: ${rawUrl}`);
  };

  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = urlFromFetchInput(input);
      if (shouldBlockNetworkUrl(rawUrl)) {
        return Promise.reject(new Error(`Offline mode blocked a non-local network request: ${rawUrl}`));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    const rawUrl = typeof url === "string" ? url : url.href;
    if (shouldBlockNetworkUrl(rawUrl)) block(rawUrl);
    return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  if ("WebSocket" in window) {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args) {
        const rawUrl = String(args[0] ?? "");
        if (shouldBlockNetworkUrl(rawUrl)) block(rawUrl);
        return Reflect.construct(target, args);
      }
    }) as typeof WebSocket;
  }

  if ("EventSource" in window) {
    const OriginalEventSource = window.EventSource;
    window.EventSource = new Proxy(OriginalEventSource, {
      construct(target, args) {
        const rawUrl = String(args[0] ?? "");
        if (shouldBlockNetworkUrl(rawUrl)) block(rawUrl);
        return Reflect.construct(target, args);
      }
    }) as typeof EventSource;
  }

  try {
    const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalSendBeacon) {
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: (url: string | URL, data?: BodyInit | null) => {
          const rawUrl = typeof url === "string" ? url : url.href;
          if (shouldBlockNetworkUrl(rawUrl)) {
            onBlocked?.(rawUrl);
            return false;
          }
          return originalSendBeacon(url, data);
        }
      });
    }
  } catch {
    // Some browsers lock navigator.sendBeacon; the rest of the guard still applies.
  }
}
