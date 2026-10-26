"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/lib/authActions";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null, email: "" });
  return (
    <form action={action} className="mt-5 flex flex-col gap-3" aria-label="Sign in">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input name="email" type="email" autoComplete="username" required defaultValue={state.email} className="rounded-md border border-border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="rounded-md border border-border px-3 py-2" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="mt-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
