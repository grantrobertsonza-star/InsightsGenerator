import { redirect } from "next/navigation";
import { optionalRequestContext } from "@/lib/requestContext";
import LoginForm from "./LoginForm";

// G6 sign-in. Accounts and organisation memberships are created by an administrator
// (scripts/auth/add-member.mjs); there is deliberately no sign-up form here.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  if (await optionalRequestContext().catch(() => null)) redirect("/");
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use the email and password your administrator set up for you.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
