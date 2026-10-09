import { KnowledgeNav } from "./KnowledgeNav";

export const metadata = {
  title: "Knowledge base · Insights Elevator",
  description: "How-to guides and short notes on research practice and on how this app does its analysis.",
};

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Knowledge base</h1>
        <p className="text-sm text-muted">How-to guides and short notes on research practice</p>
      </div>
      <div className="grid gap-10 md:grid-cols-[240px_1fr]">
        <aside className="md:sticky md:top-8 md:self-start">
          <KnowledgeNav />
        </aside>
        <div className="min-w-0 max-w-3xl">{children}</div>
      </div>
    </main>
  );
}
