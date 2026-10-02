"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FlaskConical, Upload } from "lucide-react";
import { apiFetch, formatDateTime, formatDuration, formatMoney, formatNumber, formatTime, titleCase, toLocalInput, useApi } from "@/lib/client";
import { DOCUMENT_TYPES } from "@/lib/constants";
import { MapLegend, MapView, type MapLine, type MapMarker } from "@/components/MapView";
import { useSession } from "@/components/Shell";
import { Badge, Button, Card, ErrorNote, Field, Modal, PageHeader, SeverityBadge, Spinner, StatusBadge, Table, inputClass, td, tdNum } from "@/components/ui";

type Dialog = "plan" | "tender" | "reject" | "cancel" | "problem" | null;

const OBJECTIVES = [
  { value: "cost", label: "Lowest cost" },
  { value: "distance", label: "Shortest distance" },
  { value: "time", label: "Fastest completion" },
];

export default function ShipmentPage({ params }: { params: { id: string } }) {
  const { can, organization } = useSession();
  const tz = organization.timezone;
  const { data: s, error, mutate } = useApi<any>(`/shipments/${params.id}`, { refreshInterval: 15_000 });
  const { data: tracking, mutate: mutateTracking } = useApi<{ events: any[]; path: [number, number][] }>(
    `/shipments/${params.id}/tracking`,
    { refreshInterval: 15_000 },
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [speed, setSpeed] = useState("1");
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("PROOF_OF_DELIVERY");

  if (error && !s) return <ErrorNote error={error} />;
  if (!s) return <Spinner />;

  const refresh = () => Promise.all([mutate(), mutateTracking()]);
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      setDialog(null);
      if (done) setNotice(done);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };
  const post = (path: string, body?: unknown) => apiFetch(`/shipments/${s.id}${path}`, { method: "POST", body });

  const moving = s.status === "DISPATCHED" || s.status === "IN_TRANSIT";
  const editable = s.status === "DRAFT" || s.status === "PLANNED";
  const terminal = s.status === "DELIVERED" || s.status === "CANCELLED";
  const late = moving && s.delayMinutes >= 15;
  const nextStop = s.stops.find((x: any) => x.status !== "COMPLETED");
  const ownFleetReady = s.status === "PLANNED" && s.vehicle && !s.carrier;
  const canDispatch = can("shipments:dispatch") && (s.status === "ACCEPTED" || ownFleetReady);

  // ── Map ──
  const markers: MapMarker[] = s.stops.map((stop: any, i: number) => ({
    id: stop.id,
    latitude: stop.location.latitude,
    longitude: stop.location.longitude,
    kind: stop.type === "PICKUP" ? "pickup" : "delivery",
    tone: stop.status === "COMPLETED" ? "done" : undefined,
    label: `${i + 1}. ${stop.location.name}`,
    detail: `${titleCase(stop.type)} · ${titleCase(stop.status)}`,
  }));
  if (s.currentLatitude !== null && s.currentLongitude !== null && !terminal) {
    markers.push({
      id: s.id,
      latitude: s.currentLatitude,
      longitude: s.currentLongitude,
      kind: "shipment",
      tone: late ? "late" : undefined,
      label: s.number,
      detail: `Last position ${formatDateTime(s.lastPositionAt, tz)}`,
    });
  }
  const lines: MapLine[] = [];
  if (s.routeGeometry?.length) lines.push({ id: "planned", points: s.routeGeometry, tone: "planned" });
  if (tracking && tracking.path.length > 1) lines.push({ id: "travelled", points: tracking.path, tone: "travelled" });

  const stopAction = nextStop
    ? nextStop.status === "PENDING"
      ? { type: nextStop.type === "PICKUP" ? "ARRIVED_PICKUP" : "ARRIVED_DESTINATION", label: `Mark arrived at ${nextStop.location.name}` }
      : nextStop.type === "PICKUP"
        ? { type: "DEPARTED_PICKUP", label: `Mark picked up at ${nextStop.location.name}` }
        : { type: "DELIVERED", label: `Mark delivered at ${nextStop.location.name}` }
    : null;

  const fact = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-900">{value}</dd>
    </div>
  );

  const upload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("entityType", "shipment");
    form.set("entityId", s.id);
    form.set("type", docType);
    await run("upload", () => apiFetch("/documents", { form }), `Uploaded ${file.name}`);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <PageHeader
        title={s.number}
        description={`${s.orders.map((o: any) => o.customer.name).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")} · ${s.orders.length} order${s.orders.length === 1 ? "" : "s"} · ${formatNumber(s.totalWeightKg)} kg`}
        actions={
          <>
            <StatusBadge status={s.status} />
            {late && <Badge tone="red">{s.delayMinutes} min late</Badge>}
            {editable && can("shipments:plan") && (
              <Button variant={s.status === "DRAFT" ? "primary" : "secondary"} onClick={() => setDialog("plan")}>
                {s.status === "DRAFT" ? "Plan route" : "Re-plan route"}
              </Button>
            )}
            {s.status === "PLANNED" && can("shipments:plan") && (
              <Button variant={ownFleetReady ? "secondary" : "primary"} onClick={() => setDialog("tender")}>Tender to carrier</Button>
            )}
            {s.status === "TENDERED" && can("shipments:plan") && (
              <>
                <Button variant="primary" loading={busy === "accept"} onClick={() => run("accept", () => post("/tender/respond", { accepted: true }), "Recorded: carrier accepted")}>
                  Record acceptance
                </Button>
                <Button onClick={() => setDialog("reject")}>Record rejection</Button>
              </>
            )}
            {canDispatch && (
              <Button variant="primary" loading={busy === "dispatch"} onClick={() => run("dispatch", () => post("/dispatch"), "Shipment dispatched")}>
                Dispatch
              </Button>
            )}
            {!terminal && can("shipments:write") && <Button variant="danger" onClick={() => setDialog("cancel")}>Cancel</Button>}
          </>
        }
      />

      <div className="mb-3 space-y-2">
        <ErrorNote error={actionError} />
        {notice && <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
        {s.status === "DRAFT" && <p className="text-sm text-zinc-600">Next: plan the route to sequence the stops and get a distance, schedule and cost.</p>}
        {s.status === "PLANNED" && !s.vehicle && <p className="text-sm text-zinc-600">Next: tender to a carrier, or re-plan with one of your own vehicles to dispatch it yourself.</p>}
        {s.status === "TENDERED" && <p className="text-sm text-zinc-600">Waiting for {s.carrier?.name} to answer the tender. Record their answer here once you have it.</p>}
        {s.status === "CANCELLED" && s.cancelReason && <p className="text-sm text-zinc-600">Cancelled: {s.cancelReason}</p>}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Route" padded={false} action={s.routingProvider === "haversine" ? <span className="text-xs text-zinc-500">Distances estimated from straight lines</span> : null}>
            <MapView markers={markers} lines={lines} height={380} fitKey={`${s.id}-${s.stops.length}-${Boolean(s.routeGeometry)}`} />
            <MapLegend
              items={[
                { glyph: "P", label: "Pickup" },
                { glyph: "D", label: "Delivery" },
                { glyph: "▲", label: "Current position" },
                { glyph: "▲", label: "Running late", late: true },
              ]}
            />
          </Card>

          <Card title="Stops" padded={false}>
            <Table head={["#", "Stop", "Order", "Deadline", "Planned", "Expected", "Actual", "Status"]}>
              {s.stops.map((stop: any, i: number) => {
                const deadline = stop.windowEnd ?? null;
                const stopLate = stop.status !== "COMPLETED" && deadline && stop.estimatedArrival && new Date(stop.estimatedArrival) > new Date(deadline);
                return (
                  <tr key={stop.id}>
                    <td className={td}>{i + 1}</td>
                    <td className={td}>
                      <span className="font-medium text-zinc-900">{stop.location.name}</span>
                      <span className="block text-xs text-zinc-500">{titleCase(stop.type)}</span>
                    </td>
                    <td className={td}>{stop.order ? <Link href={`/orders/${stop.order.id}`} className="underline underline-offset-2">{stop.order.number}</Link> : "—"}</td>
                    <td className={td}>{formatDateTime(deadline, tz)}</td>
                    <td className={td}>{formatDateTime(stop.plannedArrival, tz)}</td>
                    <td className={td}>
                      {stop.status === "PENDING" ? formatDateTime(stop.estimatedArrival, tz) : "—"}
                      {stopLate && <span className="ml-1.5"><Badge tone="red">Late</Badge></span>}
                    </td>
                    <td className={td}>{formatDateTime(stop.actualArrival, tz)}</td>
                    <td className={td}><StatusBadge status={stop.status} /></td>
                  </tr>
                );
              })}
            </Table>
            {moving && can("tracking:write") && stopAction && (
              <div className="flex flex-wrap gap-2 border-t border-zinc-100 p-3">
                <Button
                  variant="primary"
                  loading={busy === "stop"}
                  onClick={() => run("stop", () => apiFetch("/tracking/events", { body: { shipmentId: s.id, type: stopAction.type, stopId: nextStop.id } }))}
                >
                  {stopAction.label}
                </Button>
                <Button onClick={() => setDialog("problem")}>Report a problem</Button>
              </div>
            )}
          </Card>

          {moving && can("tracking:write") && (
            <Card title={<span className="flex items-center gap-1.5"><FlaskConical className="h-4 w-4" aria-hidden /> Simulate movement</span>}>
              <p className="text-sm text-zinc-600">
                Stands in for the vehicle&rsquo;s GPS and driver app: it reports what would have happened over the chosen time through the same tracking API a real feed uses. Simulated events are labelled in the timeline.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Traffic" className="w-52">
                  <select value={speed} onChange={(e) => setSpeed(e.target.value)} className={inputClass}>
                    <option value="1">Normal speed</option>
                    <option value="0.6">Slow traffic (60% speed)</option>
                    <option value="0.3">Heavy traffic (30% speed)</option>
                  </select>
                </Field>
                {[15, 60, 180].map((minutes) => (
                  <Button key={minutes} loading={busy === `sim-${minutes}`} onClick={() => run(`sim-${minutes}`, () => post("/simulate", { minutes, speedFactor: Number(speed) }))}>
                    Advance {formatDuration(minutes)}
                  </Button>
                ))}
                <Button loading={busy === "sim-end"} onClick={() => run("sim-end", () => post("/simulate", { minutes: 2880, speedFactor: Number(speed) }))}>
                  Run to delivery
                </Button>
              </div>
            </Card>
          )}

          <Card title="Timeline">
            {!tracking ? (
              <Spinner />
            ) : (
              <ol className="relative space-y-3 border-l border-zinc-200 pl-4">
                {[...tracking.events]
                  .reverse()
                  .filter((e, i, all) => e.type !== "LOCATION_UPDATE" || i === all.findIndex((x) => x.type === "LOCATION_UPDATE"))
                  .map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-zinc-400 ring-2 ring-white" aria-hidden />
                      <span className="font-medium text-zinc-900">{e.type === "LOCATION_UPDATE" ? "Latest position update" : titleCase(e.type)}</span>
                      <span className="ml-2 text-xs text-zinc-500">{formatDateTime(e.occurredAt, tz)}</span>
                      {e.source === "simulator" && <span className="ml-2"><Badge>Simulated</Badge></span>}
                      {e.message && <p className="text-zinc-600">{e.message}</p>}
                    </li>
                  ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Summary">
            <dl className="divide-y divide-zinc-100">
              {fact("Carrier", s.carrier ? <Link href={`/carriers/${s.carrier.id}`} className="underline underline-offset-2">{s.carrier.name}</Link> : "Own fleet / none")}
              {fact("Vehicle", s.vehicle?.name ?? "—")}
              {fact("Driver", s.driver?.name ?? "—")}
              {fact("Mode", titleCase(s.mode))}
              {fact("Distance", s.plannedDistanceKm ? `${formatNumber(s.plannedDistanceKm)} km` : "—")}
              {fact("Planned duration", formatDuration(s.plannedDurationMin))}
              {fact("Planned departure", formatDateTime(s.plannedStart, tz))}
              {fact("Dispatched", formatDateTime(s.actualStart, tz))}
              {s.status === "DELIVERED"
                ? fact("Delivered", formatDateTime(s.actualEnd, tz))
                : fact(
                    "Expected arrival",
                    s.currentEta ? (
                      <>
                        {formatDateTime(s.currentEta, tz)}
                        {s.etaWindowMinutes ? (
                          <span className="block text-xs text-zinc-500">
                            likely {formatTime(s.currentEta, tz)}–{formatTime(new Date(new Date(s.currentEta).getTime() + s.etaWindowMinutes * 60_000), tz)}
                          </span>
                        ) : null}
                      </>
                    ) : "—",
                  )}
            </dl>
          </Card>

          <Card title="Cost">
            {s.costBreakdown?.length ? (
              <>
                <ul className="space-y-2">
                  {s.costBreakdown.map((line: any) => (
                    <li key={line.code} className="flex justify-between gap-3 text-sm">
                      <span>
                        <span className="text-zinc-900">{line.label}</span>
                        <span className="block text-xs text-zinc-500">{line.calculation}</span>
                      </span>
                      <span className="tabular-nums text-zinc-900">{formatMoney(line.amount, organization.currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-between border-t border-zinc-200 pt-2 text-sm font-semibold">
                  <span>{s.status === "DELIVERED" ? "Total" : "Estimated total"}</span>
                  <span className="tabular-nums">{formatMoney(s.estimatedCost, organization.currency)}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">No cost yet. It is calculated when the route is planned on one of your vehicles or tendered to a carrier.</p>
            )}
          </Card>

          {s.exceptions.length > 0 && (
            <Card title="Exceptions" padded={false}>
              <ul className="divide-y divide-zinc-100">
                {s.exceptions.map((e: any) => (
                  <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={e.severity} />
                      <StatusBadge status={e.status} />
                    </div>
                    <p className="font-medium text-zinc-900">{e.title}</p>
                    <p className="text-zinc-600">{e.impact}</p>
                    {(e.status === "OPEN" || e.status === "INVESTIGATING") && (
                      <>
                        <p className="text-zinc-800"><span className="font-medium">Recommended:</span> {e.recommendedAction}</p>
                        {can("exceptions:write") && (
                          <Button size="sm" loading={busy === e.id} onClick={() => run(e.id, () => apiFetch(`/exceptions/${e.id}`, { method: "PATCH", body: { status: "RESOLVED" } }))}>
                            Resolve
                          </Button>
                        )}
                      </>
                    )}
                    {e.resolutionNote && <p className="text-zinc-500">Resolution: {e.resolutionNote}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Documents">
            {s.documents.length === 0 ? (
              <p className="text-sm text-zinc-500">No documents yet.</p>
            ) : (
              <ul className="space-y-2">
                {s.documents.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-zinc-900">{d.filename}</span>
                      <span className="text-xs text-zinc-500">{titleCase(d.type)} · {formatNumber(d.sizeBytes / 1024, 1)} KB · {formatDateTime(d.createdAt, tz)}</span>
                    </span>
                    <a href={`/api/v1/documents/${d.id}`} className="shrink-0 rounded p-1.5 text-zinc-600 hover:bg-zinc-100" aria-label={`Download ${d.filename}`}>
                      <Download className="h-4 w-4" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {can("documents:write") && (
              <div className="mt-3 flex items-end gap-2 border-t border-zinc-100 pt-3">
                <Field label="Document type" className="flex-1">
                  <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
                    {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                  </select>
                </Field>
                <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <Button loading={busy === "upload"} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" aria-hidden /> Upload
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-zinc-500">PDF, image, TXT or CSV, up to 5 MB.</p>
          </Card>

          {s.tenders.length > 0 && (
            <Card title="Tender history" padded={false}>
              <Table compact right={[1]} head={["Carrier", "Quoted", "Status"]}>
                {s.tenders.map((t: any) => (
                  <tr key={t.id}>
                    <td className={td}>
                      {t.carrier.name}
                      <span className="block text-xs text-zinc-500">{formatDateTime(t.sentAt, tz)}{t.responseNote ? ` · ${t.responseNote}` : ""}</span>
                    </td>
                    <td className={tdNum}>{formatMoney(t.quotedCost, organization.currency)}</td>
                    <td className={td}><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      </div>

      {dialog === "plan" && <PlanDialog busy={busy === "plan"} error={actionError} currentVehicleId={s.vehicle?.id} onClose={() => setDialog(null)} onSubmit={(body) => run("plan", () => post("/plan", body), "Route planned")} />}
      {dialog === "tender" && <TenderDialog busy={busy === "tender"} error={actionError} onClose={() => setDialog(null)} onSubmit={(carrierId) => run("tender", () => post("/tender", { carrierId }), "Tender sent")} />}
      {dialog === "reject" && (
        <ReasonDialog title="Record carrier rejection" label="Reason given by the carrier" optional confirm="Record rejection" busy={busy === "reject"} error={actionError} onClose={() => setDialog(null)}
          onSubmit={(note) => run("reject", () => post("/tender/respond", { accepted: false, note: note || undefined }), "Recorded: carrier rejected")} />
      )}
      {dialog === "cancel" && (
        <ReasonDialog title={`Cancel ${s.number}?`} label="Reason" hint="Its orders go back to open so they can be planned again." confirm="Cancel shipment" danger busy={busy === "cancel"} error={actionError} onClose={() => setDialog(null)}
          onSubmit={(reason) => run("cancel", () => post("/cancel", { reason }), "Shipment cancelled")} />
      )}
      {dialog === "problem" && (
        <ReasonDialog title="Report a problem" label="What happened?" confirm="Report" busy={busy === "problem"} error={actionError} onClose={() => setDialog(null)}
          onSubmit={(message) => run("problem", () => apiFetch("/tracking/events", { body: { shipmentId: s.id, type: "EXCEPTION", message } }), "Problem reported")} />
      )}
    </>
  );
}

function PlanDialog({ onClose, onSubmit, busy, error, currentVehicleId }: { onClose: () => void; onSubmit: (body: unknown) => void; busy: boolean; error: unknown; currentVehicleId?: string }) {
  const { data: vehicles } = useApi<{ data: any[] }>("/vehicles?limit=200");
  const [vehicleId, setVehicleId] = useState(currentVehicleId ?? "");
  const [departAt, setDepartAt] = useState(toLocalInput(new Date()));
  const [objective, setObjective] = useState("cost");
  const usable = vehicles?.data.filter((v) => v.status === "AVAILABLE" || v.id === currentVehicleId) ?? [];
  return (
    <Modal title="Plan route" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Vehicle" hint="Leave empty if a carrier will move this shipment.">
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputClass}>
            <option value="">No vehicle (carrier-moved)</option>
            {usable.map((v) => <option key={v.id} value={v.id}>{v.name} — {formatNumber(v.capacityKg)} kg</option>)}
          </select>
        </Field>
        <Field label="Departure">
          <input type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Optimize for">
          <select value={objective} onChange={(e) => setObjective(e.target.value)} className={inputClass}>
            {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} disabled={!departAt} onClick={() => onSubmit({ vehicleId: vehicleId || null, departAt: new Date(departAt).toISOString(), objective })}>
            Optimize and plan
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TenderDialog({ onClose, onSubmit, busy, error }: { onClose: () => void; onSubmit: (carrierId: string) => void; busy: boolean; error: unknown }) {
  const { data: carriers } = useApi<{ data: any[] }>("/carriers?limit=200");
  const active = carriers?.data.filter((c) => c.status === "ACTIVE") ?? [];
  const [carrierId, setCarrierId] = useState("");
  const chosen = carrierId || active[0]?.id || "";
  return (
    <Modal title="Tender to carrier" onClose={onClose}>
      {!carriers ? (
        <Spinner />
      ) : active.length === 0 ? (
        <p className="text-sm text-zinc-600">You have no active carriers. <Link href="/carriers" className="font-medium underline">Add one</Link> first.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Carrier" hint="The quote is calculated from the carrier's contract rate and this shipment's distance and weight.">
            <select value={chosen} onChange={(e) => setCarrierId(e.target.value)} className={inputClass}>
              {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <ErrorNote error={error} />
          <div className="flex justify-end">
            <Button variant="primary" loading={busy} onClick={() => onSubmit(chosen)}>Send tender</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReasonDialog({ title, label, hint, confirm, danger, optional, busy, error, onClose, onSubmit }: {
  title: string; label: string; hint?: string; confirm: string; danger?: boolean; optional?: boolean; busy: boolean; error: unknown; onClose: () => void; onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <Field label={label} hint={hint}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} className={inputClass} autoFocus />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Back</Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} disabled={!optional && !text.trim()} onClick={() => onSubmit(text.trim())}>{confirm}</Button>
        </div>
      </div>
    </Modal>
  );
}
