import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

type Handler = (req: NextRequest, context: { params: Record<string, string> }) => Promise<Response>;

export type CallOptions = {
  method?: string;
  path?: string;
  body?: unknown;
  form?: FormData;
  cookie?: string;
  apiKey?: string;
  params?: Record<string, string>;
  /** Override or drop (null) the Origin header to exercise CSRF checks. */
  origin?: string | null;
  ip?: string;
};

/** Invokes a route handler directly, the way Next.js would. */
export async function call(handler: Handler, options: CallOptions = {}) {
  const method = options.method ?? (options.body || options.form ? "POST" : "GET");
  const headers = new Headers({ host: "localhost:3000" });
  if (options.origin !== null) headers.set("origin", options.origin ?? BASE);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
  if (options.ip) headers.set("x-forwarded-for", options.ip);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const req = new NextRequest(`${BASE}${options.path ?? "/"}`, {
    method,
    headers,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const res = await handler(req, { params: options.params ?? {} });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON response (a file download).
  }
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    body,
    headers: res.headers,
    cookie: setCookie ? setCookie.split(";")[0] : undefined,
  };
}

let counter = 0;
export const unique = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;
