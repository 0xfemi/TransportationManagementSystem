"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch, formatDateTime, formatNumber, titleCase, useApi } from "@/lib/client";
import { PRIORITIES } from "@/lib/constants";
import { useSession } from "@/components/Shell";
import { Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Spinner, StatusBadge, Table, inputClass, td, tdNum } from "@/components/ui";

const STATUSES = ["OPEN", "PLANNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

type Named = { id: string; name: string };
type Line = { description: string; quantity: string; weightKg: string; volumeM3: string };
const emptyLine = (): Line => ({ description: "", quantity: "1", weightKg: "", volumeM3: "" });

function NewOrder({ onDone }: { onDone: (id: string) => void }) {
  const { data: customers } = useApi<{ data: Named[] }>("/customers?limit=200");
  const { data: locations } = useApi<{ data: (Named & { city: string | null; customerId: string | null })[] }>("/locations?limit=200");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const date = (name: string) => {
      const v = String(form.get(name) ?? "");
      return v ? new Date(v).toISOString() : null;
    };
    setBusy(true);
    setError(null);
    try {
      const order = await apiFetch<{ id: string }>("/orders", {
        body: {
          customerId: form.get("customerId"),
          pickupLocationId: form.get("pickupLocationId"),
          deliveryLocationId: form.get("deliveryLocationId"),
          priority: form.get("priority"),
          deliveryWindowStart: date("deliveryWindowStart"),
          deliveryWindowEnd: date("deliveryWindowEnd"),
          reference: form.get("reference") || null,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            weightKg: Number(l.weightKg || 0),
            volumeM3: Number(l.volumeM3 || 0),
          })),
        },
      });
      onDone(order.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  if (!customers || !locations) return <Spinner />;
  if (!customers.data.length || locations.data.length < 2) {
    return (
      <EmptyState
        title="Add a customer and two locations first"
        hint="An order needs a customer, a pickup location and a delivery location."
        action={
          <div className="flex gap-2">
            <Link href="/customers" className="text-sm font-medium underline">Customers</Link>
            <Link href="/locations" className="text-sm font-medium underline">Locations</Link>
          </div>
        }
      />
    );
  }

  const locationOptions = locations.data.map((l) => (
    <option key={l.id} value={l.id}>
      {l.name}{l.city ? ` — ${l.city}` : ""}
    </option>
  ));

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Customer">
          <select name="customerId" required className={inputClass}>
            {customers.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select name="priority" defaultValue="NORMAL" className={inputClass}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
          </select>
        </Field>
        <Field label="Pick up from">
          <select name="pickupLocationId" required className={inputClass}>{locationOptions}</select>
        </Field>
        <Field label="Deliver to">
          <select name="deliveryLocationId" required defaultValue={locations.data[1]?.id} className={inputClass}>{locationOptions}</select>
        </Field>
        <Field label="Deliver no earlier than" hint="Optional">
          <input name="deliveryWindowStart" type="datetime-local" className={inputClass} />
        </Field>
        <Field label="Deliver no later than" hint="Optional. Used to detect delays.">
          <input name="deliveryWindowEnd" type="datetime-local" className={inputClass} />
        </Field>
        <Field label="Customer reference" hint="Optional, e.g. a PO number." className="col-span-2">
          <input name="reference" maxLength={100} className={inputClass} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-700">Goods</legend>
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_6rem_6rem_2rem] items-end gap-2">
              <Field label={i === 0 ? "Description" : ""}>
                <input required value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} className={inputClass} aria-label="Description" />
              </Field>
              <Field label={i === 0 ? "Qty" : ""}>
                <input required type="number" min="0.001" step="any" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={inputClass} aria-label="Quantity" />
              </Field>
              <Field label={i === 0 ? "Weight kg" : ""}>
                <input type="number" min="0" step="any" value={line.weightKg} onChange={(e) => setLine(i, { weightKg: e.target.value })} className={inputClass} aria-label="Total weight in kg" />
              </Field>
              <Field label={i === 0 ? "Volume m³" : ""}>
                <input type="number" min="0" step="any" value={line.volumeM3} onChange={(e) => setLine(i, { volumeM3: e.target.value })} className={inputClass} aria-label="Total volume in cubic metres" />
              </Field>
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                className="mb-1.5 rounded p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                aria-label="Remove line"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">Weight and volume are totals for the line, not per unit.</p>
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => setLines((all) => [...all, emptyLine()])}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
        </Button>
      </fieldset>

      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>Create order</Button>
      </div>
    </form>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const { can, organization } = useSession();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(new URLSearchParams(window.location.search).get("status") ?? "");
  }, []);

  const query = new URLSearchParams({ limit: "100" });
  if (status) query.set("status", status);
  if (q) query.set("q", q);
  const { data, error: loadError, mutate } = useApi<{ data: any[]; total: number }>(`/orders?${query}`, { keepPreviousData: true });

  const toggle = (id: string) =>
    setSelected((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));

  const createShipment = async () => {
    setBusy(true);
    setError(null);
    try {
      const shipment = await apiFetch<{ id: string }>("/shipments", { body: { orderIds: selected } });
      router.push(`/shipments/${shipment.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description="What customers have asked you to move. Select open orders to put them on a shipment, or plan many at once in Planning."
        actions={
          <>
            {can("shipments:write") && selected.length > 0 && (
              <Button loading={busy} onClick={createShipment}>
                Create shipment from {selected.length} order{selected.length > 1 ? "s" : ""}
              </Button>
            )}
            {can("orders:write") && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New order
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3"><ErrorNote error={error} /></div>
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-zinc-100 p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, reference or customer" aria-label="Search orders" className={`${inputClass} max-w-xs`} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={`${inputClass} max-w-[11rem]`}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </div>
        {loadError ? (
          <div className="p-4"><ErrorNote error={loadError} /></div>
        ) : !data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState title="No orders match" hint={status || q ? "Try clearing the filters." : "Create your first order to start planning shipments."} />
        ) : (
          <Table right={[6]} head={["", "Order", "Customer", "From → To", "Status", "Priority", "Weight", "Deliver by", "Shipment"]}>
            {data.data.map((o) => (
              <tr key={o.id} className="hover:bg-zinc-50">
                <td className={td}>
                  {o.status === "OPEN" && can("shipments:write") && (
                    <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.number}`} className="h-4 w-4 rounded border-zinc-300" />
                  )}
                </td>
                <td className={td}>
                  <Link href={`/orders/${o.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">{o.number}</Link>
                </td>
                <td className={td}>{o.customer.name}</td>
                <td className={td}>{o.pickupLocation.name} → {o.deliveryLocation.name}</td>
                <td className={td}><StatusBadge status={o.status} /></td>
                <td className={td}>{o.priority === "NORMAL" ? "Normal" : <StatusBadge status={o.priority} />}</td>
                <td className={tdNum}>{formatNumber(o.totalWeightKg)} kg</td>
                <td className={td}>{formatDateTime(o.deliveryWindowEnd, organization.timezone)}</td>
                <td className={td}>
                  {o.shipment ? <Link href={`/shipments/${o.shipment.id}`} className="underline underline-offset-2">{o.shipment.number}</Link> : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {data && data.total > data.data.length && (
        <p className="mt-2 text-xs text-zinc-500">Showing the newest {data.data.length} of {data.total}. Narrow the search to see others.</p>
      )}

      {creating && (
        <Modal title="New order" onClose={() => setCreating(false)} wide>
          <NewOrder
            onDone={() => {
              setCreating(false);
              mutate();
            }}
          />
        </Modal>
      )}
    </>
  );
}
