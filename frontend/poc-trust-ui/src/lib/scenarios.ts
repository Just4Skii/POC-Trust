import type { Status } from "../types";

/**
 * Presentation directory for the curated demonstration scenarios seeded via /api/demo/seed.
 * Keys mirror the backend demo markers exactly (DemoSeedData, demo-assess-001…010); the backend
 * remains authoritative — this module only adds plain-language story context for the UI.
 */

export interface DemoScenario {
  key: string;
  /** Plain-language scenario name. */
  story: string;
  /** One sentence describing what the evaluator should notice. */
  summary: string;
  /** Expected outcome — mirrors the backend seed self-check. */
  expected: Status;
  offline?: boolean;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  { key: "demo-assess-001", story: "Routine hemoglobin check", summary: "Every quality control in order — calibration current, competent operator, reagent in date.", expected: "Trust" },
  { key: "demo-assess-002", story: "Glucose at a community clinic", summary: "Clean evidence from a second device — the same standard applied everywhere.", expected: "Trust" },
  { key: "demo-assess-003", story: "Malaria screening recorded while offline", summary: "Created without connectivity and synchronised later. Offline is metadata, not a reliability penalty — the evidence still passes every check.", expected: "Trust", offline: true },
  { key: "demo-assess-004", story: "Follow-up hemoglobin check", summary: "A second clean result — the kind of record a reviewer should be able to trust at a glance.", expected: "Trust" },
  { key: "demo-assess-005", story: "Calibration due soon, competency not current", summary: "Two contextual concerns at once: the device's calibration is close to its due date and the recorded operator competency has lapsed.", expected: "Review" },
  { key: "demo-assess-006", story: "Power cut during testing", summary: "A power interruption was recorded around the test, and the reagent lot is nearing expiry.", expected: "Review" },
  { key: "demo-assess-007", story: "Busy-morning gaps", summary: "Calibration approaching its due date and operator competency not current — concerns a supervisor should see before reliance.", expected: "Review" },
  { key: "demo-assess-008", story: "Failed quality control, calibration expired", summary: "A hard-stop failure: QC failed and calibration is overdue. The result must not be relied on.", expected: "Verify" },
  { key: "demo-assess-009", story: "Expired reagent lot", summary: "The reagent lot has passed its expiry date — a hard-stop verification case.", expected: "Verify" },
  { key: "demo-assess-010", story: "Missing operator and reagent records", summary: "Provenance fields were not recorded, so the result cannot pass without review.", expected: "Review" },
];

export function scenarioFor(demoKey?: string | null): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.key === demoKey);
}
