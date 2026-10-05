import { CheckIcon, CrossIcon } from "@/components/icons";

/**
 * Shared presentational pieces for the manual, so every page states "what
 * this does", "what this does not do", and "why it works this way" in the
 * same visual shape. Repetition of shape, not of wording, is the point:
 * a reader who skims five pages should recognise the pattern instantly.
 */

export function DoesDoesNot({ does, doesNot }: { does: string[]; doesNot: string[] }) {
  return (
    <div className="my-6 grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-success-light p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-success">What this does</div>
        <ul className="space-y-2">
          {does.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
              <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-border bg-danger-light p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">What this does not do</div>
        <ul className="space-y-2">
          {doesNot.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
              <CrossIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function WhyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 rounded-xl border border-blue-200 bg-primary-light p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">Why it works this way</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function ExampleBox({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="my-6 rounded-xl border border-border bg-surface p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title ?? "Example"}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">{children}</h1>;
}

export function Lede({ children }: { children: React.ReactNode }) {
  return <p className="mb-8 text-sm text-muted">{children}</p>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-lg font-semibold text-foreground">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-foreground">{children}</p>;
}
