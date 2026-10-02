"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Loader2, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { titleCase } from "@/lib/client";

// ── Buttons ──

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-700",
        variant === "secondary" && "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ── Layout ──

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className, padded = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx("rounded-lg border border-zinc-200 bg-white", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      {hint && <p className="max-w-sm text-sm text-zinc-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ── Table ──

export function Table({
  head,
  children,
  compact,
  right = [],
}: {
  head: ReactNode[];
  children: ReactNode;
  /** For tables in narrow cards: no minimum width. */
  compact?: boolean;
  /** Indexes of right-aligned (numeric) columns. */
  right?: number[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full text-left text-sm", !compact && "min-w-[640px]")}>
        <thead>
          <tr className="border-b border-zinc-200 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {head.map((h, i) => (
              <th key={i} className={clsx("whitespace-nowrap px-4 py-2.5 font-medium", right.includes(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-4 py-2.5 align-middle text-zinc-700";
export const tdNum = "px-4 py-2.5 align-middle text-right tabular-nums text-zinc-700";

// ── Badges ──

const TONES = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  green: "bg-green-50 text-green-800 ring-green-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  orange: "bg-orange-50 text-orange-900 ring-orange-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  OPEN: "blue",
  DRAFT: "neutral",
  PLANNED: "violet",
  TENDERED: "amber",
  SENT: "amber",
  ACCEPTED: "blue",
  DISPATCHED: "blue",
  IN_TRANSIT: "blue",
  DELIVERED: "green",
  COMPLETED: "green",
  CANCELLED: "neutral",
  REJECTED: "red",
  AVAILABLE: "green",
  ACTIVE: "green",
  IN_USE: "blue",
  ON_DUTY: "blue",
  ARRIVED: "blue",
  MAINTENANCE: "amber",
  INVESTIGATING: "amber",
  RESOLVED: "green",
  URGENT: "red",
  HIGH: "orange",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{titleCase(status)}</Badge>;
}

/** Severity is never colour alone: each level has its own icon and label. */
export function SeverityBadge({ severity }: { severity: string }) {
  const config = {
    CRITICAL: { tone: "red" as const, Icon: OctagonAlert },
    HIGH: { tone: "orange" as const, Icon: TriangleAlert },
    MEDIUM: { tone: "amber" as const, Icon: AlertTriangle },
    LOW: { tone: "neutral" as const, Icon: CheckCircle2 },
  }[severity] ?? { tone: "neutral" as const, Icon: AlertTriangle };
  return (
    <Badge tone={config.tone}>
      <config.Icon className="h-3 w-3" aria-hidden />
      {titleCase(severity)}
    </Badge>
  );
}

// ── Forms ──

export const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-zinc-50";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block text-sm", className)}>
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

// ── Modal ──

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx("w-full rounded-lg bg-white shadow-xl", wide ? "max-w-2xl" : "max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-500 hover:bg-zinc-100">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Stat tile ──

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "alert" }) {
  return (
    <div className="h-full rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tracking-tight", tone === "alert" ? "text-red-700" : "text-zinc-900")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
