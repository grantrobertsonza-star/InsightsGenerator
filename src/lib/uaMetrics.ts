import type { UaCondition, UaField, UaMetricSpec, UaPageId, UaRecognition, UaView } from "./uaTypes";
import { all, answerCodes, answeredCondition, clean, codes, compileUaRoute } from "./uaRouting";

export function planUaMetrics(rec: UaRecognition, lightUserMaximum: number | null = null): Pick<UaView, "metrics" | "unavailable"> {
  const metrics: UaMetricSpec[] = []; const unavailable: UaView["unavailable"] = [];
  const fields = rec.fields; const find = (role: string) => fields.find(f => f.variable === rec.roles[role]);
  const add = (f: UaField | undefined, label: string, page: UaPageId, selected?: string[], kind: UaMetricSpec["kind"] = "percent", extra: Partial<UaMetricSpec> = {}) => {
    if (!f) { unavailable.push({ label, page, reason: "Not asked in this file, or the role needs a choice." }); return; }
    try {
      const route = compileUaRoute(f, fields);
      const answered = answeredCondition(f, fields);
      const spec: UaMetricSpec = { id: `${page}:${f.variable}:${kind}:${selected?.join("_") ?? "numeric"}:${metrics.length}`, label, page, variable: f.variable, kind, unit: kind === "percent" ? "percent" : f.meta.unit ?? "value", ...route, answered, ...(f.options.length ? { validCodes: f.options.map(o => o.code) } : {}), ...(selected ? { selectedCodes: selected } : {}), reason: `${f.questionId}: ${f.meta.questionWording || f.label}. Eligibility: ${f.meta.eligibleBase}. Response state must be answered.`, period: f.meta.period ?? "Not stated", sourceQuestionIds: f.questionId ? [f.questionId] : [], ...extra };
      if (kind === "percent" && !spec.selectedCodes?.length) throw new Error("The selected raw answer code is missing or ambiguous.");
      metrics.push(spec);
    } catch (e) { unavailable.push({ label, page, reason: e instanceof Error ? e.message : String(e) }); }
  };
  const yes = (f: UaField | undefined) => f ? answerCodes(f, /^(yes|selected)$/) : [];
  const topTwo = (f: UaField) => answerCodes(f, /^(strongly agree|somewhat agree|agree|very likely|fairly likely|very satisfied|somewhat satisfied|satisfied|definitely will|probably will)$/);
  const recency = find("consumptionRecency"); const ever = find("everConsumption"); const buy = find("purchaseP3m");
  const periodCodes = (f: UaField | undefined, re: RegExp) => f ? answerCodes(f, re) : [];
  const consumptionCodes = periodCodes(recency, /^past three calendar months$/);
  const recent = recency && consumptionCodes.length === 1 ? all(answeredCondition(recency, fields), codes(recency.variable, consumptionCodes[0])) : undefined;
  const buyers = buy && yes(buy).length === 1 ? all(answeredCondition(buy, fields), codes(buy.variable, yes(buy)[0])) : undefined;
  add(ever, "Ever consumption", "footprint", yes(ever));
  add(recency, "P12M consumption", "footprint", periodCodes(recency, /past (three|twelve) calendar months/));
  add(recency, "P3M consumption", "footprint", consumptionCodes);
  add(buy, "P3M personal purchase", "footprint", yes(buy));
  add(ever, "Never consumed", "footprint", ever ? answerCodes(ever, /^no$/) : []);
  add(recency, "Lapsed category users", "footprint", periodCodes(recency, /earlier|more than/));
  for (const [role, label, population, condition] of [
    ["occasionsP3m", "Mean consumption occasions per P3M user", "consumption", recent],
    ["consumptionLitresP3m", "Mean consumption litres per P3M user", "consumption", recent],
    ["tripsP3m", "Mean shopping trips per P3M buyer", "purchase", buyers],
    ["purchaseLitresP3m", "Mean purchased litres per P3M buyer", "purchase", buyers],
    ["spendP3m", "Mean spend per answering P3M buyer", "purchase", buyers],
  ] as [string, string, string, UaCondition | undefined][]) {
    if (!condition) unavailable.push({ label, page: "repertoire", reason: `The ${population} population is not defined.` });
    else add(find(role), label, "repertoire", undefined, "mean", { eligible: condition });
  }
  for (const [mode, condition, pattern] of [["Consumption", recent, /^personally consumed carbonated soft drinks: past three calendar months/], ["Buyer", buyers, /^personally purchased from brand/]] as [string, UaCondition | undefined, RegExp][]) {
    const members = fields.filter(f => pattern.test(clean(f.label)) && f.meta.stateVariable && !/response-state/i.test(f.meta.fieldRole ?? "") && rec.brands.some(b => clean(f.label).endsWith(clean(b.label))));
    const binary = members.every(f => answerCodes(f, /^(selected|yes)$/).join() === "1" && f.options.every(o => ["0", "1"].includes(o.code)));
    if (members.length && !binary) unavailable.push({ label: `${mode} repertoire`, page: "repertoire", reason: "Repertoire needs confirmed 0/1 membership codes; this codebook uses another coding and requires a reviewed mapping." });
    if (condition && members.length && binary) add(members[0], `${mode} named-brand repertoire per recent ${mode === "Buyer" ? "buyer" : "user"}`, "repertoire", undefined, "mean", { eligible: condition, assigned: undefined, answered: all(...members.map(f => answeredCondition(f, fields))), valueVariables: members.map(f => f.variable), unit: "named brands", note: "Includes Other named brand once; excludes unbranded and unknown brand identities." });
  }
  const brandOf = (f: UaField) => rec.brands.find(b => clean(f.label).includes(clean(b.label)));
  for (const f of fields) {
    if (!f.meta.stateVariable || /response-state|administrative/i.test(f.meta.fieldRole ?? "")) continue;
    const text = clean(f.label); const wording = clean(f.meta.questionWording ?? ""); const brand = brandOf(f);
    const brandExtra = brand ? { brandCode: brand.code } : {};
    if (/personally consumed carbonated soft drinks: past three calendar months/.test(text) || /personally purchased from brand/.test(text)) {
      const isBuy = /purchased/.test(text); const gate = isBuy ? buy : recency;
      const zeroCodes = gate ? answerCodes(gate, isBuy ? /^no$/ : /earlier|more than|never/) : [];
      const logicalZero = gate && zeroCodes.length ? all(answeredCondition(gate, fields), codes(gate.variable, ...zeroCodes)) : undefined;
      if (!logicalZero) unavailable.push({ label: f.label, page: "repertoire", reason: "Same-period confirmed non-use is not defined, so population incidence is unavailable." });
      else add(f, `${brand?.label ?? f.label.split(/\u2014/).at(-1)?.trim()} P3M ${isBuy ? "buyer" : "consumption"} incidence`, "repertoire", yes(f), "percent", { ...brandExtra, eligible: undefined, assigned: undefined, logicalZero, note: "Confirmed same-window non-use only is a derived zero; unresolved states remain missing." });
    } else if (/next-opportunity choice intent/.test(text)) add(f, `${brand?.label ?? f.label} choice intent top two`, "choice", topTwo(f), "percent", brandExtra);
    else if (/p3m-buyer repurchase intent/.test(text)) add(f, `${brand?.label ?? f.label} verified P3M-buyer repurchase top two`, "experience", topTwo(f), "percent", brandExtra);
    else if (/purchase trips including/.test(text)) add(f, f.label + " per answering P3M buyer", "repertoire", undefined, "mean", { ...brandExtra, note: "Brand trip counts overlap; do not add them or label them volume share." });
    else if (/p3m experience with/.test(text)) add(f, f.label, "experience", yes(f), "percent", brandExtra);
    else if (/overall p3m satisfaction/.test(text)) add(f, `${brand?.label ?? f.label} satisfaction top two`, "experience", topTwo(f), "percent", brandExtra);
    else if (/associated with:/.test(text)) add(f, `${brand?.label ?? "Brand"} ${text.split("associated with:")[1]?.trim()} association`, "memory", yes(f), "percent", brandExtra);
    else if (/spontaneous association with/.test(text)) add(f, f.label, "memory", undefined, "verbatim", { ...brandExtra, unit: "answered verbatim responses", note: "First six eligible answered responses in file order, not a representative thematic summary. Use Coding for a reviewed frame." });
    else if (/heard of soft-drink brand/.test(text)) add(f, `${brand?.label ?? f.label} aided awareness`, "memory", yes(f), "percent", brandExtra);
    else if (/would consider brand/.test(text)) add(f, `${brand?.label ?? f.label} consideration`, "choice", yes(f), "percent", brandExtra);
    else if (/agree or disagree/.test(wording)) add(f, /like trying.*brands/.test(text) ? "Variety attitude top two" : f.label, "needs", topTwo(f));
    else if (/barrier to carbonated soft-drink consumption/.test(text)) add(f, /too expensive/.test(text) ? "Price barrier" : f.label, "choice", yes(f));
    else if (/goal for most recent consumption/.test(text)) add(f, /refresh myself/.test(text) ? "Last occasion refreshment goal" : f.label, "occasions", yes(f));
    else if (/fulfilment of most important consumption goal/.test(text)) add(f, "Top-goal low fulfilment", "needs", answerCodes(f, /^(not at all|not very|slightly)/));
    else if (/most recent.*episode|most recent.*occasion|response if first-choice|main action instead|instead of carbonated|alternative beverage|current status of postponed|reason for outstanding|change needed to proceed|expected timing of postponed|factor in most recent purchase choice|reason wanted soft drinks option/.test(text)) {
      const page: UaPageId = /postpon|first-choice|outstanding|proceed/.test(text) ? "future" : /choice|option/.test(text) ? "choice" : "occasions";
      if (f.options.length) for (const option of f.options) add(f, `${f.label}: ${option.label}`, page, [option.code]);
    }
  }
  const sugar = find("lastSugar"); add(sugar, "Last occasion low/no sugar only", "needs", sugar ? answerCodes(sugar, /^low or no sugar$/) : []);
  for (const [role, label] of [["useIntent", "Use intent top two"], ["purchaseIntent", "Purchase intent top two"]]) {
    const f = find(role); add(f, label, "future", f ? topTwo(f) : []);
  }
  const post = find("postponed"); if (post) add(post, "Postponed specific purchase", "future", yes(post));
  const status = find("postponedStatus"); const outstanding = status ? answerCodes(status, /^still postponed$/) : [];
  const postZero = post ? answerCodes(post, /^no$/) : [];
  if (status && post && outstanding.length && postZero.length) add(status, "Outstanding postponed purchase", "future", outstanding, "percent", { eligible: undefined, logicalZero: all(answeredCondition(post, fields), codes(post.variable, ...postZero)) });
  const top = find("topMind"); const first = find("firstChoice");
  const mentions = fields.filter(f => f.meta.stateVariable && /spontaneous brand mention [123], coded/i.test(f.label) && !/response-state/i.test(f.meta.fieldRole ?? ""));
  const noBrand = fields.find(f => /^no brands came to mind$/i.test(f.label) && f.meta.stateVariable);
  for (const b of rec.brands) {
    if (top && mentions.length) add(top, `${b.label} any spontaneous awareness`, "memory", ["1"], "percent", {
      brandCode: b.code, eligible: undefined,
      valueCondition: { op: "any", terms: mentions.map(f => all(answeredCondition(f, fields), codes(f.variable, b.code))!) },
      logicalZero: noBrand && yes(noBrand).length ? all(answeredCondition(noBrand, fields), codes(noBrand.variable, ...yes(noBrand))) : undefined,
      note: "Any coded spontaneous mention, each person once. Confirmed no-brand responses are zero; unknowns remain missing.",
    });
    add(top, `${b.label} spontaneous top of mind`, "memory", [b.code], "percent", { brandCode: b.code });
    add(first, `${b.label} first choice`, "choice", [b.code], "percent", { brandCode: b.code });
    for (const f of fields.filter(f => f.meta.stateVariable && !/response-state/i.test(f.meta.fieldRole ?? "") && /first brand recalled, coded/i.test(f.label))) add(f, `${b.label} ${/meal on the go/i.test(f.label) ? "meal-on-go" : "sharing-with-friends"} first recall`, "memory", [b.code], "percent", { brandCode: b.code });
  }
  if (rec.populationWeight && recent && buyers && recency && buy) {
    add(recency, "Hypothetical P3M consumers", "footprint", consumptionCodes, "percent", { weightVar: rec.populationWeight, unit: "hypothetical people", note: "Fictional planning base. Numerator is a hypothetical people total, not a market estimate." });
    add(buy, "Hypothetical P3M buyers", "footprint", yes(buy), "percent", { weightVar: rec.populationWeight, unit: "hypothetical people", note: "Fictional planning base. Numerator is a hypothetical people total." });
    const litres = find("consumptionLitresP3m");
    if (litres) add(litres, "Hypothetical P3M consumption volume", "footprint", undefined, "sum", { weightVar: rec.populationWeight, unit: "hypothetical litres", eligible: undefined, logicalZero: all(answeredCondition(recency, fields), codes(recency.variable, ...answerCodes(recency, /earlier|more than|never/))), note: "Fictional planning universe within one wave; no unknown imputation." });
    const spend = find("spendP3m");
    if (spend) add(spend, "Hypothetical P3M spend from answering buyers only", "footprint", undefined, "sum", { weightVar: rec.populationWeight, unit: "hypothetical ZAR", note: "Partial known-answer contribution, not total market spend." });
  }
  const previous = find("previousPurchase");
  const lastBasket = fields.filter(f => /^most recent purchase included brand/i.test(f.label) && f.meta.stateVariable && !/response-state/i.test(f.meta.fieldRole ?? ""));
  const beforeBasket = fields.filter(f => /^previous purchase included brand/i.test(f.label) && f.meta.stateVariable && !/response-state/i.test(f.meta.fieldRole ?? ""));
  const nameOf = (f: UaField) => clean(f.label.split(/\u2014/).at(-1) ?? "");
  const pairs = lastBasket.map(f => ({ last: f, before: beforeBasket.filter(p => nameOf(p) === nameOf(f)) }));
  if (previous && yes(previous).length === 1 && pairs.length && pairs.every(p => p.before.length === 1)) {
    add(previous, "Most recent versus previous basket change", "experience", ["1"], "percent", {
      eligible: all(answeredCondition(previous, fields), codes(previous.variable, ...yes(previous))),
      answered: all(...pairs.flatMap(p => [answeredCondition(p.last, fields), answeredCondition(p.before[0], fields)])),
      valueCondition: { op: "differentSets", left: pairs.map(p => p.last.variable), right: pairs.map(p => p.before[0].variable) },
      note: "Recalled consecutive baskets, not measured longitudinal switching or churn.",
    });
  }
  if (lightUserMaximum === null) unavailable.push({ label: "Light users", page: "audiences", reason: "Choose a maximum P3M occasion count in Question mapping; the study does not define light usage." });
  const occasions = find("occasionsP3m");
  const light = occasions && recent && lightUserMaximum !== null ? all(recent, answeredCondition(occasions, fields), { op: "range", variable: occasions.variable, min: 1, max: lightUserMaximum }) : undefined;
  // Audience filters are explicit codes of the recognised category questions; no segment is inferred.
  for (const [name, condition] of [["Non-users", ever ? all(answeredCondition(ever, fields), codes(ever.variable, ...answerCodes(ever, /^no$/))) : undefined], ["Lapsed users", recency ? all(answeredCondition(recency, fields), codes(recency.variable, ...answerCodes(recency, /earlier|more than/))) : undefined], ["P3M buyers", buyers], [`Light users (1 to ${lightUserMaximum} P3M occasions)`, light]] as [string, UaCondition | undefined][]) {
    if (!condition) continue;
    for (const f of fields.filter(f => /barrier to carbonated soft-drink consumption/i.test(f.label) && f.meta.stateVariable && !/response-state/i.test(f.meta.fieldRole ?? ""))) add(f, `${name}: ${f.label}`, "audiences", yes(f), "percent", { eligible: condition });
  }
  return { metrics, unavailable };
}
