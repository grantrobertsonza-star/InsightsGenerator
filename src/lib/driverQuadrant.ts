/**
 * Places each question on the derived against stated importance chart (the quadrant graphic described by
 * Lieberman, 2023). Both axes are centred on the average of the questions shown and scaled to standard
 * deviations, so the cross-hairs sit at the middle of the questions and the four corners mean the same
 * thing in every survey.
 *
 *   high derived, low stated   exciters      matter more than people say; a way to stand out
 *   high derived, high stated  satisfiers    the key drivers
 *   low derived, high stated   must-be's     expected, but they do not separate happy from unhappy
 *   low derived, low stated    indifference  secondary
 */
export type KanoQuadrantName = "satisfiers" | "exciters" | "mustBes" | "indifference";

export type KanoPoint = { name: string; derived: number; stated: number };
export type KanoPlaced = KanoPoint & { zx: number; zy: number; quadrant: KanoQuadrantName };

function zscores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return sd > 0 ? values.map((v) => (v - mean) / sd) : values.map(() => 0);
}

export function kanoPlace(points: KanoPoint[]): KanoPlaced[] {
  const zx = zscores(points.map((p) => p.stated));
  const zy = zscores(points.map((p) => p.derived));
  return points.map((p, i) => {
    const highStated = zx[i] >= 0;
    const highDerived = zy[i] >= 0;
    const quadrant: KanoQuadrantName = highDerived
      ? highStated
        ? "satisfiers"
        : "exciters"
      : highStated
        ? "mustBes"
        : "indifference";
    return { ...p, zx: zx[i], zy: zy[i], quadrant };
  });
}

export const KANO_LABELS: Record<KanoQuadrantName, { title: string; meaning: string }> = {
  satisfiers: { title: "Satisfiers (key drivers)", meaning: "Important to people and to the outcome. Protect these." },
  exciters: { title: "Exciters (the unexpected)", meaning: "Drive the outcome more than people say. A way to stand out." },
  mustBes: { title: "Must-be's (potential dissatisfiers)", meaning: "People expect them, but they do little to separate satisfied from unsatisfied." },
  indifference: { title: "Indifference (secondary)", meaning: "Low on both. Secondary opportunities." },
};
