import Link from "next/link";
import { articles, knowledgeHref } from "./articles";
import { H1, Lede } from "../manual/blocks";

export default function KnowledgeIndexPage() {
  const categories = [...new Set(articles.map((a) => a.category))];
  return (
    <div>
      <H1>Knowledge base</H1>
      <Lede>
        Short guides on how research is done and how this app does it. They explain the method, what the
        numbers mean, and where the method stops. More will be added over time.
      </Lede>
      {categories.map((cat) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{cat}</h2>
          <div className="grid gap-3">
            {articles
              .filter((a) => a.category === cat)
              .map((a) => (
                <Link
                  key={a.slug}
                  href={knowledgeHref(a.slug)}
                  className="rounded-xl border border-border bg-white p-4 transition hover:border-primary hover:bg-primary-light"
                >
                  <div className="text-sm font-semibold text-foreground">{a.title}</div>
                  <div className="mt-1 text-sm text-muted">{a.blurb}</div>
                  <div className="mt-2 text-xs text-muted">
                    About {a.minutes} minute read · updated {a.updated}
                  </div>
                </Link>
              ))}
          </div>
        </section>
      ))}
      <p className="text-sm text-muted">
        Looking for what a button does or what the app does not do yet? That is in the{" "}
        <Link href="/manual" className="text-primary hover:underline">
          User manual
        </Link>
        .
      </p>
    </div>
  );
}
