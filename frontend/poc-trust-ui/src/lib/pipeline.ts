import type { EvidenceInput } from "../types";
import { evidenceItems } from "./evidence.ts";

/**
 * The assessment pipeline rail model (Section 10).
 *
 * Step outcomes are derived from the SAME deterministic evidence that produced the decision, so
 * the rail can never settle all-green for a REVIEW or VERIFY outcome: a failed quality-control
 * check paints the quality step with a fail mark, calibration trouble paints the device step,
 * and so on. Nothing here evaluates reliability, the backend engine remains authoritative;
 * this only reflects its results in the UI.
 */

export type StepDomainState = "ok" | "warn" | "fail";

export interface EvalStep {
  key: string;
  label: string;
}

/** Seven steps × ~160 ms ≈ the 1–1.5 s demonstration budget (Section 10). */
export const EVAL_STEPS: EvalStep[] = [
  { key: "collect", label: "Collecting evidence" },
  { key: "device", label: "Checking device state" },
  { key: "quality", label: "Checking quality controls" },
  { key: "operator", label: "Checking operator and provenance" },
  { key: "environment", label: "Checking environment" },
  { key: "evaluate", label: "Evaluating reliability" },
  { key: "record", label: "Recording decision" },
];

const worst = (...states: StepDomainState[]): StepDomainState =>
  states.includes("fail") ? "fail" : states.includes("warn") ? "warn" : "ok";

/**
 * Per-domain outcome for each checking step, derived from evidence states (which themselves
 * come from the engine's rule IDs). The collect/evaluate/record steps are process steps: they
 * complete whenever a decision exists.
 */
export function stepDomainStates(input: EvidenceInput, ruleIds: string[]): Record<string, StepDomainState> {
  const items = Object.fromEntries(evidenceItems(input, ruleIds).map((i) => [i.key, i]));
  const state = (key: string): StepDomainState => items[key]?.state ?? "ok";
  return {
    collect: "ok",
    device: worst(state("device"), state("reagent"), state("cal")),
    quality: worst(state("qc")),
    operator: worst(state("op"), state("prov")),
    // Connectivity is synchronisation metadata only, it deliberately does NOT tint any step.
    environment: worst(state("env")),
    evaluate: "ok",
    record: "ok",
  };
}
