import type { OrphanTurnNote } from "./codingMeta";

/**
 * Plain wording of why a researcher's turn note was set aside (COD5K-F02), shared by the Quotes tab
 * and the coding export so both say the same. No server imports: the Quotes tab is client code.
 */
export const SET_ASIDE_REASON: Record<OrphanTurnNote["reason"], string> = {
  turn_missing: "that turn is no longer in the transcript",
  turn_changed: "that turn now holds different words",
  turn_unverified: "which words it was written for was not recorded",
};
