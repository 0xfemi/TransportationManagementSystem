"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { apiFetch, formatDateTime, titleCase, useApi } from "@/lib/client";
import { EXCEPTION_TYPES, SEVERITIES } from "@/lib/constants";
import { useSession } from "@/components/Shell";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, SeverityBadge, Spinner, StatusBadge, inputClass } from "@/components/ui";

const FILTERS = [
  { value: "active", label: "Open and investigating" },
  { value: "OPEN", label: "Open" },
  { value: "INVESTIGATING", label: "Investigating" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "IGNORED", label: "Ignored" },
  { value: "", label: "All" },
];

function Detail({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { can, organization } = useSession();
  const tz = organization.timezone;
  const { data: e, error, mutate } = useApi<any>(`/exceptions/${id}`);
  const { data: members } = useApi<{ data: { id: string; name: string }[] }>("/users");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorNote error={error} />;
  if (!e) return <Spinner />;

  const update = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await apiFetch(`/exceptions/${id}`, { method: "PATCH", body });
      await mutate();
      onChanged();
      setNote("");
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const active = e.status === "OPEN" || e.status === "INVESTIGATING";
  const timeline = [
    { at: e.detectedAt, text: "Exception detected", by: "System" },
    ...e.shipmentEvents.map((t: any) => ({ at: t.occurredAt, text: t.message ?? titleCase(t.type), by: titleCase(t.source) })),
    ...e.history.map((h: any) => ({ at: h.createdAt, text: h.summary + (h.reason ? `. Note: ${h.reason}` : ""), by: h.actorLabel })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={e.severity} />
        <StatusBadge status={e.status} />
        <Badge>{titleCase(e.type)}</Badge>
        {e.shipment && (
          <Link href={`/shipments/${e.shipment.id}`} onClick={onClose} className="text-sm font-medium underline underline-offset-2">
            Open {e.shipment.number}
          </Link>
        )}
      </div>
      <dl className="space-y-3 text-sm">
        <div><dt className="font-medium text-zinc-900">Issue</dt><dd className="text-zinc-700">{e.title}</dd></div>
        <div><dt className="font-medium text-zinc-900">Impact</dt><dd className="text-zinc-700">{e.impact}</dd></div>
        <div><dt className="font-medium text-zinc-900">Recommended action</dt><dd className="text-zinc-700">{e.recommendedAction}</dd></div>
        {e.resolutionNote && <div><dt className="font-medium text-zinc-900">Resolution</dt><dd className="text-zinc-700">{e.resolutionNote}</dd></div>}
      </dl>

      {can("exceptions:write") && (
        <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <Field label="Owner">
            <select
              value={e.ownerId ?? ""}
              disabled={busy === "owner"}
              onChange={(ev) => update("owner", { ownerId: ev.target.value || null })}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {members?.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          {active ? (
            <>
              <Field label="Note" hint="What was done about it. Saved with the resolution and in the audit log.">
                <input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} className={inputClass} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={busy === "resolve"} onClick={() => update("resolve", { status: "RESOLVED", resolutionNote: note || undefined })}>Resolve</Button>
                {e.status === "OPEN" && <Button loading={busy === "investigate"} onClick={() => update("investigate", { status: "INVESTIGATING" })}>Start investigating</Button>}
                <Button variant="ghost" loading={busy === "ignore"} onClick={() => update("ignore", { status: "IGNORED", resolutionNote: note || undefined })}>Ignore</Button>
              </div>
            </>
          ) : (
            <Button loading={busy === "reopen"} onClick={() => update("reopen", { status: "OPEN" })}>Reopen</Button>
          )}
          <ErrorNote error={actionError} />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900">Timeline</h3>
        <ol className="max-h-64 space-y-2 overflow-y-auto border-l border-zinc-200 pl-4">
          {timeline.map((t, i) => (
            <li key={i} className="text-sm">
              <span className="text-xs text-zinc-500">{formatDateTime(t.at, tz)} · {t.by}</span>
              <p className="text-zinc-800">{t.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Report({ onDone }: { onDone: () => void }) {
  const { data: shipments } = useApi<{ data: { id: string; number: string }[] }>("/shipments?status=PLANNED,TENDERED,ACCEPTED,DISPATCHED,IN_TRANSIT&limit=200");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = Object.fromEntries(new FormData(ev.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/exceptions", { body: { ...form, shipmentId: form.shipmentId || null, recommendedAction: form.recommendedAction || undefined } });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-4">
      <Field label="Type">
        <select name="type" defaultValue="VEHICLE_BREAKDOWN" className={inputClass}>
          {EXCEPTION_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </Field>
      <Field label="Severity">
        <select name="severity" defaultValue="MEDIUM" className={inputClass}>
          {SEVERITIES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
        </select>
      </Field>
      <Field label="Shipment" hint="Optional" className="col-span-2">
        <select name="shipmentId" className={inputClass}>
          <option value="">Not tied to a shipment</option>
          {shipments?.data.map((s) => <option key={s.id} value={s.id}>{s.number}</option>)}
        </select>
      </Field>
      <Field label="What is the issue?" className="col-span-2"><input name="title" required maxLength={200} className={inputClass} /></Field>
      <Field label="What is the impact?" className="col-span-2"><input name="impact" required maxLength={1000} className={inputClass} /></Field>
      <Field label="Recommended action" hint="Optional" className="col-span-2"><input name="recommendedAction" maxLength={1000} className={inputClass} /></Field>
      <div className="col-span-2 space-y-3">
        <ErrorNote error={error} />
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy}>Report exception</Button></div>
      </div>
    </form>
  );
}

export default function ExceptionsPage() {
  const { can, organization } = useSession();
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const query = new URLSearchParams({ limit: "100" });
  if (status) query.set("status", status);
  if (severity) query.set("severity", severity);
  const { data, error, mutate } = useApi<{ data: any[]; total: number }>(`/exceptions?${query}`, { keepPreviousData: true, refreshInterval: 20_000 });

  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Everything that has gone off plan: what happened, what it affects and what to do about it."
        actions={can("exceptions:write") && (
          <Button variant="primary" onClick={() => setReporting(true)}><Plus className="h-4 w-4" aria-hidden /> Report exception</Button>
        )}
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-zinc-100 p-3">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={`${inputClass} max-w-[14rem]`}>
            {FILTERS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity" className={`${inputClass} max-w-[11rem]`}>
            <option value="">All severities</option>
            {[...SEVERITIES].reverse().map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
          </select>
        </div>
        {error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState title={status === "active" ? "No open exceptions" : "No exceptions match"} hint={status === "active" ? "Delays, rejected tenders and reported problems will appear here." : "Try a different filter."} />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {data.data.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpen(e.id)} className="block w-full space-y-1 px-4 py-3 text-left hover:bg-zinc-50">
                  <span className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={e.severity} />
                    <StatusBadge status={e.status} />
                    <span className="text-xs text-zinc-500">{formatDateTime(e.detectedAt, organization.timezone)}</span>
                    {e.shipment && <span className="text-xs text-zinc-500">· {e.shipment.number}</span>}
                  </span>
                  <span className="block text-sm font-medium text-zinc-900">{e.title}</span>
                  <span className="block text-sm text-zinc-600">{e.impact}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <Modal title="Exception" onClose={() => setOpen(null)} wide>
          <Detail id={open} onChanged={() => mutate()} onClose={() => setOpen(null)} />
        </Modal>
      )}
      {reporting && (
        <Modal title="Report an exception" onClose={() => setReporting(false)} wide>
          <Report onDone={() => { setReporting(false); mutate(); }} />
        </Modal>
      )}
    </>
  );
}
