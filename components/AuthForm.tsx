"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { Button, ErrorNote, Field, inputClass } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const register = mode === "register";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await apiFetch(register ? "/auth/register" : "/auth/login", { body: form });
      const next = new URLSearchParams(window.location.search).get("next");
      // Only follow same-site paths, never an absolute URL from the query.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/command-center";
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="text-sm font-semibold text-zinc-900">Transportation Management System</p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900">
          {register ? "Create your organization" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {register ? "You will be its first admin." : "Use your work email and password."}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
          {register && (
            <>
              <Field label="Organization name">
                <input name="organizationName" required maxLength={120} className={inputClass} autoComplete="organization" />
              </Field>
              <Field label="Your name">
                <input name="name" required maxLength={120} className={inputClass} autoComplete="name" />
              </Field>
            </>
          )}
          <Field label="Email">
            <input name="email" type="email" required className={inputClass} autoComplete="email" />
          </Field>
          <Field label="Password" hint={register ? "At least 10 characters." : undefined}>
            <input
              name="password"
              type="password"
              required
              minLength={register ? 10 : 1}
              className={inputClass}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {register ? "Create organization" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-zinc-500">
          {register ? "Already have an account? " : "New here? "}
          <Link href={register ? "/login" : "/register"} className="font-medium text-zinc-900 underline underline-offset-2">
            {register ? "Sign in" : "Create an organization"}
          </Link>
        </p>
      </div>
    </main>
  );
}
