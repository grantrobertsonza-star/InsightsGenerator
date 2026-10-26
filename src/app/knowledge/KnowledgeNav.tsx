"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { articles, knowledgeHref, type ArticleCategory } from "./articles";

export function KnowledgeNav() {
  const pathname = usePathname();
  const categories = [...new Set(articles.map((a) => a.category))] as ArticleCategory[];
  return (
    <nav className="space-y-5">
      <Link
        href="/knowledge"
        className={`block rounded-lg px-3 py-2 text-sm transition ${
          pathname === "/knowledge" ? "bg-primary-light font-medium text-primary" : "text-foreground hover:bg-surface"
        }`}
      >
        All guides
      </Link>
      {categories.map((cat) => (
        <div key={cat}>
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{cat}</div>
          <div className="space-y-1">
            {articles
              .filter((a) => a.category === cat)
              .map((a) => {
                const href = knowledgeHref(a.slug);
                const active = pathname === href;
                return (
                  <Link
                    key={a.slug}
                    href={href}
                    className={`block rounded-lg px-3 py-2 text-sm transition ${
                      active ? "bg-primary-light font-medium text-primary" : "text-foreground hover:bg-surface"
                    }`}
                  >
                    <div>{a.title}</div>
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}
