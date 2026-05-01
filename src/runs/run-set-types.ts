export type RunSetKind = "single" | "batch";

export interface RunSetCtx {
  runSetId: string;
  kind: RunSetKind;
  passes: number;
  cards: string[];      // cardIds, in deterministic order
  cardIndex: number;    // 0-indexed position in `cards`
  attemptNumber: number; // 1-indexed within the (cards × attempts) loop
}

export type SetBucket =
  | "consistent_pass"
  | "consistent_investigate"
  | "consistent_fail"
  | "mixed"
  | "mixed_with_errors"
  | "errored";
