import { ManualNav } from "./ManualNav";

export const metadata = {
  title: "User manual · Insights Elevator",
  description:
    "What Insights Elevator does, how it works, and what it doesn't do.",
};

export default function ManualLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">User manual</h1>
        <p className="text-sm text-muted">
          What Insights Elevator does, and doesn&apos;t do
        </p>
      </div>
      <div className="grid gap-10 md:grid-cols-[220px_1fr]">
        <aside className="md:sticky md:top-8 md:self-start">
          <ManualNav />
        </aside>
        <div className="min-w-0 max-w-2xl">{children}</div>
      </div>
    </main>
  );
}
