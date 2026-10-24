import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallbackPageWords } from '../../shared/ui/chatgpt';
import { CALLBACK_PATH } from './oauth';

/**
 * The loopback listener a sign-in's answer comes back to (PLAN 5.7; OpenAI's
 * sign-in page, read 2026-10-24): `http://127.0.0.1:<port>/auth/callback`,
 * on a port the system picks for each attempt, listening before the browser
 * opens and closed once the answer is in, the attempt is cancelled or the
 * app quits.
 *
 * It answers only a GET of the callback path whose Host is its own address,
 * so a web page that rebinds a name to 127.0.0.1 gets nothing; an answer that
 * is not this attempt's (`isOurs`) is told so and the wait goes on. The page
 * it serves is the app's own words, never anything it was sent, with no
 * script, no cache and no referrer.
 */

export interface Callback {
  query: URLSearchParams;
  /** answer the browser's tab with this page; the listener closes after it */
  respond: (page: CallbackPageWords, status?: number) => void;
}

export interface Loopback {
  redirectUri: string;
  /** the first answer `isOurs` takes; rejects when the listener closes first */
  callback: Promise<Callback>;
  /** stop listening; a tab still waiting is answered with `page` */
  close: (page: CallbackPageWords) => void;
}

/** The page's HTML: the app's own words, escaped, and nothing else. */
export function callbackHtml(page: CallbackPageWords): string {
  const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(page.title)}</title>`,
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36em;margin:4em auto;padding:0 1em}</style>',
    '</head>',
    `<body><h1>${escape(page.title)}</h1><p>${escape(page.text)}</p></body>`,
    '</html>'
  ].join('\n');
}

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  connection: 'close'
} as const;

function send(res: ServerResponse, status: number, page: CallbackPageWords): void {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, HEADERS);
  res.end(callbackHtml(page));
}

export interface LoopbackOptions {
  /** whether an answer is this attempt's, by its state */
  isOurs: (query: URLSearchParams) => boolean;
  /** the page for an answer that is not this attempt's */
  notOurs: CallbackPageWords;
  /** answer the browser with this when nothing has answered it within `respondWithinMs` */
  late: CallbackPageWords;
  respondWithinMs?: number;
}

/** Listen on 127.0.0.1, on a port the system picks. */
export async function openLoopback(options: LoopbackOptions): Promise<Loopback> {
  let settle: { resolve: (callback: Callback) => void; reject: (err: Error) => void } | null = null;
  const callback = new Promise<Callback>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Nobody may be listening when the listener is closed at once; the rejection is still the caller's to see.
  callback.catch(() => undefined);
  let taken = false;
  let waiting: ServerResponse | null = null;
  let host = '';

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET', connection: 'close' }).end();
      return;
    }
    if (req.headers.host !== host) {
      res.writeHead(400, { connection: 'close' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { connection: 'close' }).end();
      return;
    }
    if (taken || !options.isOurs(url.searchParams)) {
      send(res, 400, options.notOurs);
      return;
    }
    taken = true;
    waiting = res;
    const timer = setTimeout(() => send(res, 200, options.late), options.respondWithinMs ?? 60_000);
    res.on('close', () => clearTimeout(timer));
    settle?.resolve({
      query: url.searchParams,
      respond: (page, status = 200) => {
        clearTimeout(timer);
        send(res, status, page);
        stop();
      }
    });
  });

  const stop = (): void => {
    server.close();
    server.closeIdleConnections();
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;

  return {
    redirectUri: `http://${host}${CALLBACK_PATH}`,
    callback,
    close: (page) => {
      if (waiting) send(waiting, 200, page);
      settle?.reject(new Error('The sign-in listener closed.'));
      stop();
      // A tab that keeps its connection open would hold the server; the answer is already sent.
      setTimeout(() => server.closeAllConnections(), 1000).unref();
    }
  };
}
