import PptxGenJS from "pptxgenjs";
import { addArgumentMapSlide, addFooter } from "../src/lib/deckSlides";

const governingThought =
  "NLI, education, and structural vulnerability move almost identically, suggesting they are largely the same " +
  "latent construct rather than four separate targeting dimensions, and building separate strategies for each " +
  "risks redundant spend on the same population while genuinely unmeasured factors like trust and reliability " +
  "stay neglected.";

const pillars4 = [
  { headline: "Employment, age, and education are the most reliable predictors of DFS use, but together they still leave most of the usage gap unexplained." },
  { headline: "The gender, metro, and income subgroup effects and the cost-burden story everyone wants to act on are built on the thinnest, most fragile data in the set." },
  { headline: "Gender, metro, and income-based subgroup differences look dramatic mainly because the underlying samples are too small to trust." },
  { headline: "The four customer segments and provincial gaps reveal real behavioral differences but aren't yet precise enough to set budget cutoffs." },
];

async function main() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const s4 = addArgumentMapSlide(pptx, { governingThought, pillars: pillars4 });
  addFooter(s4, "Validate Existing", "The shape of this argument (4 pillars)");

  const s3 = addArgumentMapSlide(pptx, { governingThought, pillars: pillars4.slice(0, 3) });
  addFooter(s3, "Validate Existing", "The shape of this argument (3 pillars)");

  const s1 = addArgumentMapSlide(pptx, { governingThought, pillars: pillars4.slice(0, 1) });
  addFooter(s1, "Validate Existing", "The shape of this argument (1 pillar)");

  await pptx.writeFile({ fileName: "argflow-test.pptx" });
  console.log("wrote deck");
}

main();
