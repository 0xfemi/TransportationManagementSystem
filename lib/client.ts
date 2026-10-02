"use client";

import useSWR, { type SWRConfiguration } from "swr";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Calls the same REST API that external developers use. */
export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: options.method ?? (options.body !== undefined || options.form ? "POST" : "GET"),
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    credentials: "same-origin",
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const details = payload?.error?.details;
    const fieldErrors = Array.isArray(details)
      ? details.map((d: { path?: string; message: string }) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; ")
      : "";
    throw new ApiClientError(
      res.status,
      [payload?.error?.message ?? `Request failed (${res.status})`, fieldErrors].filter(Boolean).join(" — "),
      details,
    );
  }
  return payload as T;
}

export function useApi<T = any>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T, ApiClientError>(path, (p: string) => apiFetch<T>(p), {
    revalidateOnFocus: false,
    ...config,
  });
}

// ── Formatting ──

export const titleCase = (value: string) =>
  value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function formatDateTime(value: string | Date | null | undefined, timeZone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined, timeZone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function formatDate(value: string | Date | null | undefined, timeZone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

export function formatMoney(value: number | null | undefined, currency = "USD", compact = false) {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

export function formatDuration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m ? `${m} min` : ""}`.trim() : `${m} min`;
}

/** Value for a datetime-local input, in the browser's time zone. */
export function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
