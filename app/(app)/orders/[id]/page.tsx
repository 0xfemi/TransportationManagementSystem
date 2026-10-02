"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, formatDateTime, formatNumber, titleCase, useApi } from "@/lib/client";
import { useSession } from "@/components/Shell";
import { Button, Card, ErrorNote, Field, Modal, PageHeader, Spinner, StatusBadge, Table, inputClass, td, tdNum } from "@/components/ui";

export default function OrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { can, organization } = useSession();
  const tz = organization.timezone;
  const { data: order, error, mutate } = useApi<any>(`/orders/${params.id}`);
  const { data: audit } = useApi<{ data: any[] }>(can("audit:read") ? `/audit-log?entityType=order&entityId=${params.id}` : null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorNote error={error} />;
  if (!order) return <Spinner />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-900">{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        title={order.number}
        description={`${order.customer.name} · created ${formatDateTime(order.createdAt, tz)}`}
        actions={
          <>
            <StatusBadge status={order.status} />
            {order.status === "OPEN" && can("shipments:write") && (
              <Button
                variant="primary"
                loading={busy}
                onClick={() =>
                  run(async () => {
                    const shipment = await apiFetch<{ id: string }>("/shipments", { body: { orderIds: [order.id] } });
                    router.push(`/shipments/${shipment.id}`);
                  })
                }
              >
                Create shipment
              </Button>
            )}
            {order.status === "OPEN" && can("orders:write") && (
              <Button variant="danger" onClick={() => setCancelling(true)}>Cancel order</Button>
            )}
          </>
        }
      />
      <div className="mb-3"><ErrorNote error={actionError} /></div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details">
          <dl className="divide-y divide-zinc-100">
            {row("Priority", titleCase(order.priority))}
            {row("Pick up from", order.pickupLocation.name)}
            {row("Deliver to", order.deliveryLocation.name)}
            {row("Deliver no earlier than", formatDateTime(order.deliveryWindowStart, tz))}
            {row("Deliver no later than", formatDateTime(order.deliveryWindowEnd, tz))}
            {row("Customer reference", order.reference ?? "—")}
            {row(
              "Shipment",
              order.shipment ? (
                <Link href={`/shipments/${order.shipment.id}`} className="font-medium underline underline-offset-2">
                  {order.shipment.number}
                </Link>
              ) : (
                "Not yet planned"
              ),
            )}
          </dl>
        </Card>

        <Card title="Goods" padded={false} className="lg:col-span-2">
          <Table head={["Description", "Quantity", "Weight", "Volume"]}>
            {order.lines.map((l: any) => (
              <tr key={l.id}>
                <td className={td}>{l.description}</td>
                <td className={tdNum}>{formatNumber(l.quantity, 2)}</td>
                <td className={tdNum}>{formatNumber(l.weightKg, 1)} kg</td>
                <td className={tdNum}>{formatNumber(l.volumeM3, 2)} m³</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className={td}>Total</td>
              <td className={tdNum} />
              <td className={tdNum}>{formatNumber(order.totalWeightKg, 1)} kg</td>
              <td className={tdNum}>{formatNumber(order.totalVolumeM3, 2)} m³</td>
            </tr>
          </Table>
        </Card>
      </div>

      {audit && audit.data.length > 0 && (
        <Card title="History" className="mt-4">
          <ol className="space-y-2">
            {[...audit.data].reverse().map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="w-32 shrink-0 text-zinc-500">{formatDateTime(a.createdAt, tz)}</span>
                <span className="text-zinc-800">
                  {a.summary}
                  <span className="text-zinc-500"> — {a.actorLabel}{a.reason ? `. Reason: ${a.reason}` : ""}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {cancelling && (
        <Modal title={`Cancel ${order.number}?`} onClose={() => setCancelling(false)}>
          <Field label="Reason" hint="Recorded in the audit log.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} autoFocus />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setCancelling(false)}>Keep order</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!reason.trim()}
              onClick={() =>
                run(async () => {
                  await apiFetch(`/orders/${order.id}/cancel`, { body: { reason } });
                  setCancelling(false);
                  await mutate();
                })
              }
            >
              Cancel order
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
