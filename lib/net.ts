// Every network call that books a shipment or reads a chat message goes through here, so none of them can wait forever.
export const NETWORK_TIMEOUT_MS = 15000;

export class TimeoutError extends Error {
  constructor() { super('timeout'); this.name = 'TimeoutError'; }
}

export type JsonResponse = { res: Response; json: any };

/**
 * fetch + read the JSON body, abandoned after `ms` (default 15 s). The whole thing is raced against the timer,
 * so it also gives up when the request is stuck and ignores the abort signal. Rejects with TimeoutError.
 */
export function fetchJson(input: string, init: RequestInit = {}, ms = NETWORK_TIMEOUT_MS): Promise<JsonResponse> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const clock = new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new TimeoutError()); }, ms); });
  const work = (async () => {
    const res = await fetch(input, { ...init, signal: ctl.signal });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  })();
  work.catch(() => {});                       // a late failure after the timeout must not become an unhandled rejection
  return Promise.race([work, clock]).finally(() => clearTimeout(timer));
}
