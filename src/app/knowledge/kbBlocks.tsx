import Link from "next/link";
import { H1, Lede, P, DoesDoesNot, WhyBox, ExampleBox } from "../manual/blocks";
import { articles, knowledgeHref } from "./articles";

export { P, DoesDoesNot, WhyBox, ExampleBox };

/** Section heading with an anchor, so the contents list at the top can link to it. */
export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 mt-10 scroll-mt-6 text-lg font-semibold text-foreground">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-semibold text-foreground">{children}</h3>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground">{children}</ul>;
}

export function OL({ children }: { children: React.ReactNode }) {
  return <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground">{children}</ol>;
}

/** A small reference table; the first row is the header. */
export function Table({ rows, caption }: { rows: string[][]; caption?: string }) {
  const [head, ...body] = rows;
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        {caption && <caption className="border-b border-border bg-surface px-3 py-2 text-left text-xs text-muted">{caption}</caption>}
        <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "font-medium text-foreground" : "text-foreground"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A limitation, written so a reader can judge how far to trust the result. */
export function Limit({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Limitation: {title}</div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

export type Source = { citation: string; url: string };

/** APA 7 reference list. Every entry carries a DOI or a working link. */
export function References({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-10 border-t border-border pt-6">
      <h2 className="mb-3 text-lg font-semibold text-foreground">References</h2>
      <ul className="space-y-2 text-sm leading-relaxed text-foreground">
        {sources.map((s) => (
          <li key={s.url} className="pl-6 -indent-6">
            {s.citation}{" "}
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
              {s.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Wraps one guide: title, short intro, a contents list, the body, and
 * previous/next links driven off the same list as the sidebar.
 */
export function Article({
  slug,
  title,
  lede,
  toc,
  children,
}: {
  slug: string;
  title: string;
  lede: string;
  toc: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  const index = articles.findIndex((a) => a.slug === slug);
  const meta = articles[index];
  const prev = index > 0 ? articles[index - 1] : null;
  const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : null;
  return (
    <article>
      <H1>{title}</H1>
      <Lede>{lede}</Lede>
      {meta && (
        <p className="-mt-5 mb-6 text-xs text-muted">
          {meta.category} · about {meta.minutes} minute read · updated {meta.updated}
        </p>
      )}
      <nav aria-label="On this page" className="mb-8 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">On this page</div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {toc.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="text-primary hover:underline">
                {t.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {children}
      {(prev || next) && (
        <div className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-6">
          {prev ? (
            <Link href={knowledgeHref(prev.slug)} className="text-sm font-medium text-primary hover:underline">
              &larr; {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={knowledgeHref(next.slug)} className="text-sm font-medium text-primary hover:underline">
              {next.title} &rarr;
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </article>
  );
}
