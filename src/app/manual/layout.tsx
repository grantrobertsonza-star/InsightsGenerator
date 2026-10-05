import Link from "next/link";
import { ManualNav } from "./ManualNav";

export const metadata = {
  title: "User manual · Insights Elevator",
  description: "What Insights Elevator does, how it works, and what it doesn't do.",
};

export default function ManualLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
          <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-white shadow-sm">
            IE
          </Link>
          <div>
            <div className="text-base font-semibold text-foreground">User manual</div>
            <div className="text-xs text-muted">What Insights Elevator does, and doesn&apos;t do</div>
          </div>
          <Link href="/" className="ml-auto text-sm font-medium text-muted hover:text-primary">
            &larr; Back to the app
          </Link>
        </div>
      </header>
      <div className="brand-accent-bar" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[220px_1fr]">
          <aside className="md:sticky md:top-8 md:self-start">
            <ManualNav />
          </aside>
          <div className="min-w-0 max-w-2xl">{children}</div>
        </div>
      </main>
    </>
  );
}
