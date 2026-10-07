import { capWords } from "../src/lib/text";

const realExecSummary =
  "Across the accepted evidence, structural and demographic advantage (age, education, employment and income) " +
  "robustly predicts DFS adoption, but these factors explain only part of the story, leaving roughly three " +
  "quarters of the variance in usage intensity unexplained by anything currently measured. Subgroup interaction " +
  "effects on gender, metro status, and neighbourhood-level income look statistically striking in places, with " +
  "odds ratios running into the thousands, but are better read as artifacts of sparse cells and quasi-separation " +
  "than as reliable targeting signals. The single highest-priority action is to commission a properly powered, " +
  "regularized re-analysis before any segment-specific product or equity strategy is locked in against these " +
  "interaction effects.";

console.log("--- 85 words (old cap) ---");
console.log(capWords(realExecSummary, 85));
console.log();
console.log("--- 115 words (new cap) ---");
console.log(capWords(realExecSummary, 115));
console.log();

const shortNoSentenceBoundary = "a b c d e f g h i j k l m n o p q r s t";
console.log("--- fallback hard cut (no period in range) ---");
console.log(capWords(shortNoSentenceBoundary, 10));
