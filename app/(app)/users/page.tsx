"use client";

import { useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { apiFetch, formatDate, useApi } from "@/lib/client";
import { ROLES } from "@/lib/constants";
import { PERMISSIONS, ROLE_LABELS, can as roleCan } from "@/lib/rbac";
import { useSession } from "@/components/Shell";
import { Button, Card, ErrorNote, Field, Modal, PageHeader, Spinner, Table, inputClass, td } from "@/components/ui";

type Member = { id: string; name: string; email: string; role: (typeof ROLES)[number]; memberSince: string };

const PERMISSION_LABELS: Record<string, string> = {
  "masterdata:read": "View customers, locations, carriers, fleet",
  "masterdata:write": "Edit customers, locations, carriers, fleet",
  "orders:read": "View orders",
  "orders:write": "Create and edit orders",
  "shipments:read": "View shipments",
  "shipments:write": "Create and cancel shipments",
  "shipments:plan": "Plan routes and tender",
  "shipments:dispatch": "Dispatch shipments",
  "tracking:write": "Report tracking events",
  "exceptions:read": "View exceptions",
  "exceptions:write": "Handle exceptions",
  "documents:read": "View documents",
  "documents:write": "Upload documents",
  "analytics:read": "View analytics",
  "audit:read": "View audit log",
  "users:manage": "Manage users",
  "settings:manage": "Manage settings and API keys",
};

export default function UsersPage() {
  const session = useSession();
  const { data, error, mutate } = useApi<{ data: Member[] }>("/users");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [formError, setFormError] = useState<unknown>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await mutate();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy("add");
    setFormError(null);
    try {
      await apiFetch("/users", { body: Object.fromEntries(new FormData(e.currentTarget)) });
      setAdding(false);
      await mutate();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Who can sign in to this organization and what each role is allowed to do. Role changes take effect on the person's next request."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add user</Button>}
      />
      <div className="mb-3"><ErrorNote error={actionError ?? error} /></div>
      <Card padded={false}>
        {!data ? (
          <Spinner />
        ) : (
          <Table head={["Name", "Email", "Role", "Member since", ""]}>
            {data.data.map((m) => (
              <tr key={m.id}>
                <td className={`${td} font-medium text-zinc-900`}>{m.name}{m.id === session.user?.id && <span className="ml-1.5 text-xs font-normal text-zinc-500">(you)</span>}</td>
                <td className={td}>{m.email}</td>
                <td className={td}>
                  <select
                    value={m.role}
                    disabled={busy === m.id}
                    onChange={(e) => run(m.id, () => apiFetch(`/users/${m.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                    aria-label={`Role for ${m.name}`}
                    className={`${inputClass} h-8 max-w-[12rem]`}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td className={td}>{formatDate(m.memberSince, session.organization.timezone)}</td>
                <td className={`${td} text-right`}>
                  {m.id !== session.user?.id && (
                    <Button size="sm" variant="ghost" loading={busy === `rm-${m.id}`} onClick={() => run(`rm-${m.id}`, () => apiFetch(`/users/${m.id}`, { method: "DELETE" }))}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="What each role can do" padded={false} className="mt-4">
        <Table head={["Permission", ...ROLES.map((r) => ROLE_LABELS[r])]}>
          {PERMISSIONS.map((p) => (
            <tr key={p}>
              <td className={td}>{PERMISSION_LABELS[p] ?? p}</td>
              {ROLES.map((r) => (
                <td key={r} className={td}>
                  {roleCan(r, p) ? <Check className="h-4 w-4 text-zinc-800" aria-label="Allowed" /> : <span className="text-zinc-300" aria-label="Not allowed">–</span>}
                </td>
              ))}
            </tr>
          ))}
        </Table>
      </Card>

      {adding && (
        <Modal title="Add user" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-4">
            <Field label="Name"><input name="name" required maxLength={120} className={inputClass} /></Field>
            <Field label="Email"><input name="email" type="email" required className={inputClass} /></Field>
            <Field label="Temporary password" hint="At least 10 characters. Share it with them securely.">
              <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
            </Field>
            <Field label="Role">
              <select name="role" defaultValue="PLANNER" className={inputClass}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <ErrorNote error={formError} />
            <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy === "add"}>Add user</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
