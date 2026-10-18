import { signOut, switchOrganisation } from "@/lib/authActions";
import { optionalRequestContext } from "@/lib/requestContext";

/**
 * G6: who is signed in and which organisation this view belongs to, at the foot of the left rail.
 * Renders nothing when nobody is signed in (the sign-in page). A failure to check the session is
 * shown here as a short notice rather than hiding the panel, so an outage is not mistaken for
 * being signed out; the page's own data loaders refuse independently.
 */
export default async function AccountPanel() {
  let context;
  try {
    context = await optionalRequestContext();
  } catch {
    return <div className="mx-3 mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-900">Sign-in could not be checked.</div>;
  }
  if (!context) return null;
  return (
    <div className="mx-3 mt-3 border-t border-border pt-3 text-[11px] text-muted" data-testid="account-panel">
      <div className="truncate font-medium text-foreground" title={context.email ?? undefined}>{context.email ?? "Signed in"}</div>
      {context.memberships.length > 1 ? (
        <form action={switchOrganisation} className="mt-1 flex items-center gap-1">
          <select name="tenantId" defaultValue={context.tenantId} aria-label="Organisation" className="min-w-0 flex-1 rounded border border-border px-1 py-0.5">
            {context.memberships.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>{m.organisationName}</option>
            ))}
          </select>
          <button type="submit" className="rounded border border-border px-1.5 py-0.5">Switch</button>
        </form>
      ) : (
        <div className="truncate" data-testid="account-organisation">{context.organisationName}</div>
      )}
      <form action={signOut} className="mt-2">
        <button type="submit" className="text-primary hover:underline">Sign out</button>
      </form>
    </div>
  );
}
