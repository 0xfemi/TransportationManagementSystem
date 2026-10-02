"use client";

import { useState } from "react";
import { formatDateTime, titleCase, useApi } from "@/lib/client";
import { useSession } from "@/components/Shell";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner, Table, inputClass, td } from "@/components/ui";

const PAGE = 50;

const show = (value: unknown) =>
  value === null || value === undefined ? "none" : typeof value === "object" ? JSON.stringify(value) : String(value);

export default function AuditLogPage() {
  const { organization } = useSession();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (q) query.set("q", q);
  const { data, error } = useApi<{ data: any[]; total: number }>(`/audit-log?${query}`, { keepPreviousData: true });

  return (
    <>
      <PageHeader title="Audit log" description="Who changed what, and when. Entries cannot be edited or removed." />
      <Card padded={false}>
        <div className="border-b border-zinc-100 p-3">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }}
            placeholder="Search by what changed or who changed it"
            aria-label="Search audit log"
            className={`${inputClass} max-w-sm`}
          />
        </div>
        {error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState title="No entries match" />
        ) : (
          <Table head={["When", "Who", "What", "Change"]}>
            {data.data.map((a) => (
              <tr key={a.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(a.createdAt, organization.timezone)}</td>
                <td className={td}>
                  {a.actorLabel ?? titleCase(a.actorType)}
                  {a.actorType !== "user" && <span className="block text-xs text-zinc-500">{titleCase(a.actorType)}</span>}
                </td>
                <td className={td}>
                  {a.summary}
                  {a.reason && <span className="block text-xs text-zinc-500">Reason: {a.reason}</span>}
                </td>
                <td className={`${td} text-xs`}>
                  {a.after
                    ? Object.keys(a.after).map((key) => (
                        <span key={key} className="block">
                          <span className="text-zinc-500">{key}:</span> {a.before ? `${show(a.before[key])} → ` : ""}{show(a.after[key])}
                        </span>
                      ))
                    : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 text-sm text-zinc-600">
            <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
            <span className="flex gap-2">
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</Button>
              <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Older</Button>
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
