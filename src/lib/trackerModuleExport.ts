// R5story: assembles the brand tracking deck for one data file (trackerModuleSlides.ts) from the registered pages'
// figures, recomputed now, and the researcher's decisions on the AI drafts (dashboardInsights.ts). The route
// (src/app/api/runs/[id]/tracker-dashboard/export/route.ts) checks the tenant and project first and calls this.
// A page that fails to calculate is a slide saying so; nothing is left out silently.
import { withTenantRead } from "./db";
import { loadAllDrafts, loadStoryInputs, MODULE_PAGE, pageHashesOf, storyInputsHash } from "./dashboardInsights";
import { dashboardPages, loadPageFigures, type PageFigures } from "./trackerDashboardCards";
import { buildTrackerModuleDeck, type DeckPage, type ModuleDeckInput, type StoryText } from "./trackerModuleSlides";

export async function trackerModuleDeckInput(tenantId: string, runId: string, documentId: string, options: { includeDrafts: boolean; now?: Date }): Promise<ModuleDeckInput> {
  const filename = await withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ source_filename: string }>("select source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3", [documentId, runId, tenantId]);
    if (r.rowCount !== 1) throw new Error("That data file is not in this project.");
    return r.rows[0].source_filename;
  });
  const registered = dashboardPages();
  const loaded = await Promise.all(
    registered.map(async (p) => {
      try {
        return { id: p.id, title: p.title, page: await loadPageFigures(tenantId, runId, documentId, p.id) };
      } catch (e) {
        return { id: p.id, title: p.title, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const okPages = loaded.flatMap((l) => ("page" in l && l.page ? [l.page as PageFigures] : []));
  const hashes = pageHashesOf(okPages);
  const drafts = await loadAllDrafts(tenantId, runId, documentId);
  const pages: DeckPage[] = loaded.map((l, i) => {
    if (!("page" in l) || !l.page) return { number: i + 1, id: l.id, title: l.title, status: "failed", error: "error" in l ? l.error : undefined, cards: [], insights: { accepted: [], drafts: [], staleAccepted: 0, draftsLeftOut: 0 } };
    const page = l.page;
    const mine = drafts.rows.filter((r) => r.page === l.id && r.kind === "insight");
    const current = (r: (typeof mine)[number]) => r.figuresHash === hashes.get(l.id);
    return {
      number: i + 1,
      id: l.id,
      title: l.title,
      status: "ok",
      ctx: page.ctx,
      cards: page.cards.map((c) => ({ ...c, sentence: page.sentences.get(c.card) ?? null })),
      insights: {
        accepted: mine.filter((r) => r.status === "accepted" && current(r)).map((r) => r.text),
        drafts: mine.filter((r) => r.status === "draft" && current(r)).map((r) => r.text),
        staleAccepted: mine.filter((r) => r.status === "accepted" && !current(r)).length,
        draftsLeftOut: mine.filter((r) => r.status === "draft" && current(r)).length,
      },
    };
  });
  const inputs = await loadStoryInputs(tenantId, runId, documentId, hashes);
  const inputsHash = storyInputsHash(inputs);
  const storyOf = (kind: "summary" | "conclusions"): StoryText => {
    const rows = drafts.rows.filter((r) => r.page === MODULE_PAGE && r.kind === kind);
    const accepted = rows.find((r) => r.status === "accepted" && r.figuresHash === inputsHash);
    if (accepted) return { state: "accepted", text: accepted.text };
    const draft = rows.find((r) => r.status === "draft" && r.figuresHash === inputsHash);
    if (options.includeDrafts && draft) return { state: "draft", text: draft.text };
    if (inputs.length === 0) return { state: "nothing_accepted" };
    if (rows.some((r) => r.status === "accepted")) return { state: "stale" };
    return { state: "not_accepted", drafts: rows.filter((r) => r.status === "draft" && r.figuresHash === inputsHash).length };
  };
  const first = okPages.find((p) => p.page === "overview") ?? okPages[0];
  return {
    filename,
    wave: first?.ctx.wave ?? null,
    focal: first?.ctx.focal?.label ?? null,
    weighting: first ? (first.ctx.weighted && first.ctx.weightVar ? `weighted by ${first.ctx.weightVar}` : "unweighted") : "not known",
    generatedAt: options.now ?? new Date(),
    includeDrafts: options.includeDrafts,
    pages,
    summary: storyOf("summary"),
    conclusions: storyOf("conclusions"),
  };
}

/** The deck as PowerPoint bytes. */
export async function exportTrackerModuleDeck(tenantId: string, runId: string, documentId: string, options: { includeDrafts: boolean; now?: Date }): Promise<{ pptx: Buffer; filename: string; input: ModuleDeckInput }> {
  const input = await trackerModuleDeckInput(tenantId, runId, documentId, options);
  const deck = await buildTrackerModuleDeck(input);
  const pptx = (await deck.write({ outputType: "nodebuffer" })) as Buffer;
  return { pptx, filename: input.filename, input };
}
