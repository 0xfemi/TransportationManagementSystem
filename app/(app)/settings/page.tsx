"use client";

import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";
import { apiFetch, formatDateTime, useApi } from "@/lib/client";
import { ROLES } from "@/lib/constants";
import { ROLE_LABELS } from "@/lib/rbac";
import { useSession } from "@/components/Shell";
import { Button, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner, Table, inputClass, td } from "@/components/ui";

export default function SettingsPage() {
  const { organization } = useSession();
  const { mutate: mutateGlobal } = useSWRConfig();
  const { data: keys, mutate } = useApi<{ data: any[] }>("/api-keys");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [keyError, setKeyError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      await apiFetch("/organization", { method: "PATCH", body: Object.fromEntries(new FormData(e.currentTarget)) });
      await mutateGlobal("/auth/me");
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const createKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy("key");
    setKeyError(null);
    try {
      const created = await apiFetch<{ name: string; key: string }>("/api-keys", { body: Object.fromEntries(new FormData(form)) });
      setNewKey(created);
      form.reset();
      await mutate();
    } catch (err) {
      setKeyError(err);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    setBusy(id);
    setKeyError(null);
    try {
      await apiFetch(`/api-keys/${id}`, { method: "DELETE" });
      await mutate();
    } catch (err) {
      setKeyError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Organization details and API access." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Organization">
          <form onSubmit={save} className="grid grid-cols-2 gap-4">
            <Field label="Name" className="col-span-2">
              <input name="name" required defaultValue={organization.name} maxLength={120} className={inputClass} />
            </Field>
            <Field label="Currency" hint="ISO code, e.g. USD, CAD, NGN.">
              <input name="currency" required defaultValue={organization.currency} minLength={3} maxLength={3} className={`${inputClass} uppercase`} />
            </Field>
            <Field label="Time zone" hint="IANA name, e.g. Africa/Lagos.">
              <input name="timezone" required defaultValue={organization.timezone} className={inputClass} />
            </Field>
            <div className="col-span-2 space-y-3">
              <ErrorNote error={error} />
              <div className="flex items-center justify-end gap-3">
                {saved && <span role="status" className="text-sm text-green-700">Saved</span>}
                <Button type="submit" variant="primary" loading={busy === "save"}>Save changes</Button>
              </div>
            </div>
          </form>
          <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
            Currency sets how amounts are displayed; it does not convert existing rates. Weights are stored in kilograms and distances in kilometres.
          </p>
        </Card>

        <Card title="API keys" padded={false}>
          <div className="space-y-3 p-4">
            <p className="text-sm text-zinc-600">
              For systems that call the API, such as a telematics feed posting tracking events. Send the key as{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>. A key can do what its role can do.
            </p>
            {newKey && (
              <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Copy the key for “{newKey.name}” now. It will not be shown again.</p>
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs text-zinc-900">{newKey.key}</code>
              </div>
            )}
            <form onSubmit={createKey} className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="min-w-[10rem] flex-1"><input name="name" required maxLength={80} placeholder="e.g. Telematics feed" className={inputClass} /></Field>
              <Field label="Role" className="w-44">
                <select name="role" defaultValue="DISPATCHER" className={inputClass}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </Field>
              <Button type="submit" loading={busy === "key"}>Create key</Button>
            </form>
            <ErrorNote error={keyError} />
          </div>
          {!keys ? (
            <Spinner />
          ) : keys.data.length === 0 ? (
            <EmptyState title="No API keys" />
          ) : (
            <Table head={["Name", "Key", "Role", "Last used", ""]}>
              {keys.data.map((k) => (
                <tr key={k.id}>
                  <td className={`${td} font-medium text-zinc-900`}>{k.name}</td>
                  <td className={td}><code className="text-xs">{k.prefix}…</code></td>
                  <td className={td}>{ROLE_LABELS[k.role as keyof typeof ROLE_LABELS]}</td>
                  <td className={td}>{k.lastUsedAt ? formatDateTime(k.lastUsedAt, organization.timezone) : "Never"}</td>
                  <td className={`${td} text-right`}><Button size="sm" variant="danger" loading={busy === k.id} onClick={() => revoke(k.id)}>Revoke</Button></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
