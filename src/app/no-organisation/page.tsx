import { signOut } from "@/lib/authActions";

// G6: a signed-in account that no administrator has added to an organisation sees this and
// nothing else. requestContext refuses every page, action and download for it.
export default function NoOrganisationPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">No organisation yet</h1>
        <p className="mt-2 text-sm text-muted">
          You are signed in, but your account has not been added to an organisation, so there is nothing to show. Ask your administrator to add you, then sign in again.
        </p>
        <form action={signOut} className="mt-4">
          <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm">Sign out</button>
        </form>
      </div>
    </main>
  );
}
