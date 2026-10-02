"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { apiFetch, useApi } from "@/lib/client";
import { useSession } from "./Shell";
import { Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Spinner, Table, inputClass, td } from "./ui";

export type FieldConfig = {
  name: string;
  label: string;
  /** "boolean" renders a Yes / No choice and submits true or false. */
  type?: "text" | "email" | "number" | "select" | "boolean";
  required?: boolean;
  hint?: string;
  step?: string;
  options?: { value: string; label: string }[];
  /** Load select options from an API collection. */
  optionsFrom?: string;
  defaultValue?: string | number;
  half?: boolean;
};

export type ResourceConfig = {
  title: string;
  singular: string;
  description: string;
  path: string;
  columns: { header: string; render: (row: any) => ReactNode; numeric?: boolean }[];
  fields: FieldConfig[];
  rowHref?: (row: any) => string;
};

/** Reads a query parameter once on mount (e.g. a search carried by a link). */
export function useInitialParam(name: string) {
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name) ?? "");
  }, [name]);
  return [value, setValue] as const;
}

function RemoteOptions({ path }: { path: string }) {
  const { data } = useApi<{ data: { id: string; name: string }[] }>(`${path}?limit=200`);
  return (
    <>
      {data?.data.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </>
  );
}

function ResourceForm({ config, row, onDone }: { config: ResourceConfig; row: any | null; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // A value the system manages (a vehicle that is "in use", a driver who is
  // "on duty") is not one of the choices, so the field is left out entirely
  // rather than silently overwritten.
  const fields = config.fields.filter(
    (f) => !(row && f.options && !f.optionsFrom && row[f.name] && !f.options.some((o) => o.value === row[f.name])),
  );

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = String(form.get(field.name) ?? "").trim();
      if (field.type === "number") {
        if (raw !== "") body[field.name] = Number(raw);
      } else if (field.type === "boolean") {
        body[field.name] = raw === "true";
      } else {
        body[field.name] = raw === "" ? null : raw;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(row ? `${config.path}/${row.id}` : config.path, { method: row ? "PATCH" : "POST", body });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-4">
      {fields.map((field) => {
        const initial = row?.[field.name] ?? field.defaultValue ?? "";
        return (
          <Field key={field.name} label={field.label} hint={field.hint} className={field.half ? "col-span-1" : "col-span-2"}>
            {field.type === "boolean" ? (
              <select name={field.name} defaultValue={String(initial)} className={inputClass}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : field.type === "select" ? (
              <select name={field.name} defaultValue={initial} required={field.required} className={inputClass}>
                {!field.required && <option value="">None</option>}
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {field.optionsFrom && <RemoteOptions path={field.optionsFrom} />}
              </select>
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                step={field.type === "number" ? (field.step ?? "any") : undefined}
                defaultValue={initial}
                required={field.required}
                className={inputClass}
              />
            )}
          </Field>
        );
      })}
      <div className="col-span-2 space-y-3">
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button type="submit" variant="primary" loading={busy}>
            {row ? "Save changes" : `Add ${config.singular}`}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ResourcePage({ config }: { config: ResourceConfig }) {
  const { can } = useSession();
  const [q, setQ] = useInitialParam("q");
  const { data, error, mutate } = useApi<{ data: any[]; total: number }>(
    `${config.path}?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    { keepPreviousData: true },
  );
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const writable = can("masterdata:write");

  const remove = async () => {
    setBusy(true);
    setRemoveError(null);
    try {
      await apiFetch(`${config.path}/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await mutate();
    } catch (err) {
      setRemoveError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          writable && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" aria-hidden /> Add {config.singular}
            </Button>
          )
        }
      />
      <Card padded={false}>
        <div className="border-b border-zinc-100 p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${config.title.toLowerCase()}`}
            aria-label={`Search ${config.title.toLowerCase()}`}
            className={`${inputClass} max-w-xs`}
          />
        </div>
        {error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState
            title={q ? `No ${config.title.toLowerCase()} match “${q}”` : `No ${config.title.toLowerCase()} yet`}
            hint={q ? undefined : `Add your first ${config.singular} to start using it in orders and plans.`}
          />
        ) : (
          <Table head={[...config.columns.map((c) => c.header), ""]}>
            {data.data.map((row) => (
              <tr key={row.id} className="hover:bg-zinc-50">
                {config.columns.map((column) => (
                  <td key={column.header} className={`${td} ${column.numeric ? "text-right tabular-nums" : ""}`}>
                    {column.render(row)}
                  </td>
                ))}
                <td className={`${td} whitespace-nowrap text-right`}>
                  {writable && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(row)}>Remove</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editing && (
        <Modal title={editing === "new" ? `Add ${config.singular}` : `Edit ${editing.name}`} onClose={() => setEditing(null)} wide>
          <ResourceForm
            config={config}
            row={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              mutate();
            }}
          />
        </Modal>
      )}
      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm text-zinc-600">
            It will no longer be available for new orders and plans. Existing orders and shipments keep their reference to it.
          </p>
          <div className="mt-4 space-y-3">
            <ErrorNote error={removeError} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRemoving(null)}>Keep it</Button>
              <Button variant="danger" loading={busy} onClick={remove}>Remove {config.singular}</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
