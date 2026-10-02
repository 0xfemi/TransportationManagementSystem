"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { apiFetch, formatDateTime, formatMoney, titleCase, toLocalInput, useApi } from "@/lib/client";
import { MAINTENANCE_TYPES } from "@/lib/constants";
import { useSession } from "@/components/Shell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Stat,
  StatusBadge,
  Table,
  inputClass,
  td,
  tdNum,
} from "@/components/ui";

const FILTERS = [
  { value: "open", label: "Scheduled and in progress" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

type WorkOrder = {
  id: string;
  number: string;
  type: string;
  status: string;
  title: string;
  vendor: string | null;
  notes: string | null;
  scheduledFor: string;
  startedAt: string | null;
  completedAt: string | null;
  cost: number | null;
  cancelReason: string | null;
  vehicle: { id: string; name: string; registration: string | null; status: string };
};

const isOverdue = (o: WorkOrder) => o.status === "SCHEDULED" && new Date(o.scheduledFor).getTime() < Date.now();

function Schedule({ onDone }: { onDone: () => void }) {
  const { data: vehicles } = useApi<{ data: { id: string; name: string; registration: string | null }[] }>("/vehicles?limit=200");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/maintenance", {
        body: {
          vehicleId: value("vehicleId"),
          type: value("type"),
          title: value("title"),
          scheduledFor: new Date(value("scheduledFor")).toISOString(),
          vendor: value("vendor") || null,
          notes: value("notes") || null,
        },
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  // Default to tomorrow at 08:00, local time.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-4">
      <Field label="Vehicle" className="col-span-2">
        <select name="vehicleId" required className={inputClass}>
          {vehicles?.data.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.registration ? ` (${v.registration})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <select name="type" defaultValue="INSPECTION" className={inputClass}>
          {MAINTENANCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Scheduled for">
        <input name="scheduledFor" type="datetime-local" required defaultValue={toLocalInput(tomorrow)} className={inputClass} />
      </Field>
      <Field label="What needs doing" className="col-span-2">
        <input name="title" required maxLength={200} placeholder="e.g. 50,000 km service" className={inputClass} />
      </Field>
      <Field label="Workshop or technician" className="col-span-2">
        <input name="vendor" maxLength={120} className={inputClass} />
      </Field>
      <Field label="Notes" className="col-span-2">
        <input name="notes" maxLength={2000} className={inputClass} />
      </Field>
      <div className="col-span-2 space-y-3">
        <ErrorNote error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            Schedule work order
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Completing records the cost; cancelling records why. */
function Close({ order, mode, onDone }: { order: WorkOrder; mode: "complete" | "cancel"; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/maintenance/${order.id}/${mode}`, {
        body:
          mode === "complete"
            ? { cost: value("cost") ? Number(value("cost")) : null, notes: value("notes") || null }
            : { reason: value("reason") },
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-zinc-600">
        {order.number} · {order.vehicle.name} · {order.title}
      </p>
      {mode === "complete" ? (
        <>
          <Field label="Cost" hint="Optional. In your organization's currency.">
            <input name="cost" type="number" min="0" step="any" className={inputClass} />
          </Field>
          <Field label="Notes">
            <input name="notes" maxLength={2000} defaultValue={order.notes ?? ""} className={inputClass} />
          </Field>
        </>
      ) : (
        <Field label="Reason" hint="Saved on the work order and in the audit log.">
          <input name="reason" required maxLength={500} className={inputClass} />
        </Field>
      )}
      {order.status === "IN_PROGRESS" && (
        <p className="text-xs text-zinc-500">
          {order.vehicle.name} returns to service unless it has other work in progress.
        </p>
      )}
      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant={mode === "complete" ? "primary" : "danger"} loading={busy}>
          {mode === "complete" ? "Mark completed" : "Cancel work order"}
        </Button>
      </div>
    </form>
  );
}

export default function MaintenancePage() {
  const { can, organization } = useSession();
  const tz = organization.timezone;
  const [status, setStatus] = useState("open");
  const [scheduling, setScheduling] = useState(false);
  const [closing, setClosing] = useState<{ order: WorkOrder; mode: "complete" | "cancel" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const { data, error, mutate } = useApi<{ data: WorkOrder[]; total: number }>(
    `/maintenance?limit=200${status ? `&status=${status}` : ""}`,
    { keepPreviousData: true },
  );
  // Counts come from the open list regardless of the filter shown.
  const { data: open, mutate: mutateOpen } = useApi<{ data: WorkOrder[] }>("/maintenance?status=open&limit=200");
  const writable = can("masterdata:write");

  const refresh = async () => {
    await Promise.all([mutate(), mutateOpen()]);
  };

  const start = async (order: WorkOrder) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      await apiFetch(`/maintenance/${order.id}/start`, { method: "POST" });
      await refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  };

  const openOrders = open?.data ?? [];
  const inShop = new Set(openOrders.filter((o) => o.status === "IN_PROGRESS").map((o) => o.vehicle.id));

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Vehicle work orders. Starting one takes the vehicle out of service, so planning and dispatch stop offering it; completing or cancelling it brings the vehicle back."
        actions={
          writable && (
            <Button variant="primary" onClick={() => setScheduling(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Schedule work order
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Scheduled" value={openOrders.filter((o) => o.status === "SCHEDULED").length} />
        <Stat label="In progress" value={openOrders.filter((o) => o.status === "IN_PROGRESS").length} />
        <Stat
          label="Overdue"
          value={openOrders.filter(isOverdue).length}
          sub="Scheduled date has passed"
          tone={openOrders.some(isOverdue) ? "alert" : undefined}
        />
        <Stat label="Vehicles out of service" value={inShop.size} />
      </div>

      <Card
        padded={false}
        title="Work orders"
        action={
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${inputClass} h-8 w-auto`}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        }
      >
        {actionError ? (
          <div className="px-4 pt-4">
            <ErrorNote error={actionError} />
          </div>
        ) : null}
        {error ? (
          <div className="p-4">
            <ErrorNote error={error} />
          </div>
        ) : !data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No work orders here"
            hint="Schedule inspections, services and repairs so the planner knows when a vehicle is unavailable."
            action={writable && <Button onClick={() => setScheduling(true)}>Schedule work order</Button>}
          />
        ) : (
          <Table head={["Work order", "Vehicle", "Type", "Scheduled", "Status", "Cost", ""]} right={[5]}>
            {data.data.map((o) => (
              <tr key={o.id}>
                <td className={td}>
                  <p className="font-medium text-zinc-900">{o.number}</p>
                  <p className="text-xs text-zinc-500">{o.title}</p>
                  {o.cancelReason && <p className="text-xs text-zinc-500">Cancelled: {o.cancelReason}</p>}
                </td>
                <td className={td}>
                  {o.vehicle.name}
                  {o.vehicle.registration && <span className="text-zinc-500"> · {o.vehicle.registration}</span>}
                </td>
                <td className={td}>{titleCase(o.type)}</td>
                <td className={td}>
                  {formatDateTime(o.scheduledFor, tz)}
                  {isOverdue(o) && (
                    <span className="ml-1.5">
                      <Badge tone="red">Overdue</Badge>
                    </span>
                  )}
                  {o.vendor && <p className="text-xs text-zinc-500">{o.vendor}</p>}
                </td>
                <td className={td}>
                  <StatusBadge status={o.status} />
                </td>
                <td className={tdNum}>{formatMoney(o.cost, organization.currency)}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {writable && o.status === "SCHEDULED" && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" loading={busyId === o.id} onClick={() => start(o)}>
                        Start
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setClosing({ order: o, mode: "cancel" })}>
                        Cancel
                      </Button>
                    </span>
                  )}
                  {writable && o.status === "IN_PROGRESS" && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="primary" onClick={() => setClosing({ order: o, mode: "complete" })}>
                        Complete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setClosing({ order: o, mode: "cancel" })}>
                        Cancel
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {scheduling && (
        <Modal title="Schedule work order" onClose={() => setScheduling(false)} wide>
          <Schedule
            onDone={async () => {
              setScheduling(false);
              await refresh();
            }}
          />
        </Modal>
      )}
      {closing && (
        <Modal
          title={closing.mode === "complete" ? "Complete work order" : "Cancel work order"}
          onClose={() => setClosing(null)}
        >
          <Close
            order={closing.order}
            mode={closing.mode}
            onDone={async () => {
              setClosing(null);
              await refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
