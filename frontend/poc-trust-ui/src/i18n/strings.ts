import type { TFunction } from "i18next";
import { i18next, EN_BUNDLE } from "./index.ts";
import { FALLBACK_LOCALE, type LocaleCode } from "./locales.ts";
import {
  evidenceStateCopy, humanizeReason, ruleCopy, STATUS_COPY,
  type HumanReason, type RuleCopy,
} from "../lib/labels.ts";
import type { Status } from "../types.ts";

/**
 * Localised presentation strings over the central humanization module (spec sections 2 & 4).
 *
 * This EXTENDS src/lib/labels.ts — rule ID → message key → localised string — it does not
 * replace or duplicate it. labels.ts remains the pure-English core that the copy guard
 * validates in Node; this module overlays reviewed catalog lookups at render time.
 *
 * FAMILY-UNIT FALLBACK (spec section 4): a driver is only shown in a locale when its whole
 * key family (title / explanation / action) resolves in that locale; otherwise the family
 * falls back to English AS A UNIT, so the operator never sees a half-translated
 * explanation chain. The same gate applies to decision and evidence-state families.
 */

export type TextOptions = { lng?: LocaleCode };

/** All catalog keys for one concept family, in a fixed order. */
const DECISION_VARIANTS = ["label", "description", "strip", "next_action", "can_rely"] as const;
const DRIVER_VARIANTS = ["title", "explanation", "action"] as const;
const STATE_VARIANTS = ["label", "meaning"] as const;

function activeLng(): LocaleCode {
  const lng = i18next.language;
  return lng === "zu-ZA" || lng === "xh-ZA" || lng === "af-ZA" || lng === "en-ZA" ? lng : FALLBACK_LOCALE;
}

function bundleFor(lng: LocaleCode): Record<string, unknown> {
  try {
    return (i18next.getResourceBundle(lng, "translation") ?? {}) as Record<string, unknown>;
  } catch {
    return {}; // i18n not initialised (Node-side checks) — callers fall back to English.
  }
}

/**
 * Decide the language a family renders in: the preferred locale when EVERY key of the
 * family exists there (non-empty), otherwise English as a unit.
 */
function familyLng(base: string, variants: readonly string[], preferred?: LocaleCode): LocaleCode {
  const target = preferred ?? activeLng();
  if (target === FALLBACK_LOCALE) return FALLBACK_LOCALE;
  const bundle = bundleFor(target);
  const complete = variants.every((v) => {
    const value = bundle[`${base}.${v}`];
    return typeof value === "string" && value.length > 0;
  });
  return complete ? target : FALLBACK_LOCALE;
}

function tFor(lng: LocaleCode): TFunction {
  return ((key: string, values?: Record<string, unknown>) => {
    try {
      return i18next.t(key, { lng, ...values }) as string;
    } catch {
      return ""; // i18n not initialised (Node-side checks) — English fallback applies.
    }
  }) as TFunction;
}

const statusKey = (s: Status): string => s.toLowerCase();

/** English-bundle fallback keeps every accessor safe even before i18n is initialised. */
const tOrEnglish = (lng: LocaleCode, key: string, values?: Record<string, unknown>): string => {
  const localised = tFor(lng)(key, values);
  return localised || EN_BUNDLE[key] || "";
};

export function decisionStatusLabel(status: Status, opts?: TextOptions): string {
  const key = `decision.${statusKey(status)}.label`;
  return tOrEnglish(familyLng(`decision.${statusKey(status)}`, DECISION_VARIANTS, opts?.lng), key);
}

export function decisionDescription(status: Status, opts?: TextOptions): string {
  const key = `decision.${statusKey(status)}.description`;
  return tOrEnglish(familyLng(`decision.${statusKey(status)}`, DECISION_VARIANTS, opts?.lng), key);
}

/** Hero kicker line above the status badge (e.g. "Concerns need review"). */
export function statusStrip(status: Status, opts?: TextOptions): string {
  const key = `decision.${statusKey(status)}.strip`;
  return tOrEnglish(familyLng(`decision.${statusKey(status)}`, DECISION_VARIANTS, opts?.lng), key);
}

/** Presented next-action instruction for the disposition (the canonical wording stays data). */
export function decisionNextAction(status: Status, opts?: TextOptions): string {
  const key = `decision.${statusKey(status)}.next_action`;
  return tOrEnglish(familyLng(`decision.${statusKey(status)}`, DECISION_VARIANTS, opts?.lng), key);
}

/** "Can I rely on this result?" answer line. */
export function canRely(status: Status, opts?: TextOptions): string {
  const key = `decision.${statusKey(status)}.can_rely`;
  return tOrEnglish(familyLng(`decision.${statusKey(status)}`, DECISION_VARIANTS, opts?.lng), key);
}

export interface LocalisedRuleCopy extends RuleCopy {
  /** Presented next action for this driver (part of the fixed key family). */
  action: string;
}

/** Rule ID → driver.<rule>.title/.explanation/.action — one rule, one fixed key family. */
export function driverCopy(ruleId: string, opts?: TextOptions): LocalisedRuleCopy {
  const english = ruleCopy(ruleId);
  const base = `driver.${ruleId.toLowerCase()}`;
  // Unknown/future rule IDs (not in any catalog) keep the pure-English humanized fallback.
  const enBundle = bundleFor(FALLBACK_LOCALE);
  const catalogued = DRIVER_VARIANTS.every((v) => typeof enBundle[`${base}.${v}`] === "string");
  if (!catalogued) return { ...english, action: english.sentence };
  const lng = familyLng(base, DRIVER_VARIANTS, opts?.lng);
  const t = tFor(lng);
  return {
    label: t(`${base}.title`) || EN_BUNDLE[`${base}.title`] || english.label,
    sentence: t(`${base}.explanation`) || EN_BUNDLE[`${base}.explanation`] || english.sentence,
    action: t(`${base}.action`) || EN_BUNDLE[`${base}.action`] || english.sentence,
    pushes: english.pushes,
  };
}

export function evidenceStateLocal(state: string, opts?: TextOptions): { label: string; meaning: string } {
  const base = `evidence.state.${state}`;
  const lng = familyLng(base, STATE_VARIANTS, opts?.lng);
  const t = tFor(lng);
  const english = evidenceStateCopy(state);
  return { label: t(`${base}.label`) || EN_BUNDLE[`${base}.label`] || english.label, meaning: t(`${base}.meaning`) || EN_BUNDLE[`${base}.meaning`] || english.meaning };
}

/**
 * Humanized reason with the driver family overlaid from the active catalog, plus the
 * family's presented next action. Unknown/future rule IDs keep the pure-English
 * humanized fallback from labels.ts — they can never leak machine text.
 */
export function humanizeReasonLocal(reason: string, opts?: TextOptions): HumanReason & { action?: string } {
  const base = humanizeReason(reason);
  if (!base.ruleId) return base;
  const copy = driverCopy(base.ruleId, opts);
  return { ...base, label: copy.label, text: copy.sentence, action: copy.action };
}

/** Evidence row labels (spec section 4: evidence.<item>.label families). */
export function evidenceItemLabel(itemKey: string, opts?: TextOptions): string {
  const english =
    itemKey === "device" ? "Device" : itemKey === "qc" ? "Quality control" : itemKey === "cal" ? "Calibration / maintenance"
    : itemKey === "op" ? "Operator" : itemKey === "reagent" ? "Reagent" : itemKey === "env" ? "Environment"
    : itemKey === "prov" ? "Provenance" : itemKey === "conn" ? "Connectivity" : itemKey;
  const enBundle = bundleFor(FALLBACK_LOCALE);
  if (typeof enBundle[`evidence.${itemKey}.label`] !== "string") return english;
  return tFor(opts?.lng ?? activeLng())(`evidence.${itemKey}.label`) || EN_BUNDLE[`evidence.${itemKey}.label`] || english;
}

/**
 * Date-bearing templates (evidence.<item>.last_verified): the date is DATA interpolated at
 * render time — never baked into the translated string (spec section 4). Single-key lookup:
 * i18next's built-in English fallback covers missing translations.
 */
export function evidenceTemplate(itemKey: string, date: string, opts?: TextOptions): string {
  const english = itemKey === "device" ? "Recorded {{date}}" : itemKey === "cal" ? "Due {{date}}" : "Expires {{date}}";
  const enBundle = bundleFor(FALLBACK_LOCALE);
  if (typeof enBundle[`evidence.${itemKey}.last_verified`] !== "string") return english.replace("{{date}}", date);
  return tFor(opts?.lng ?? activeLng())(`evidence.${itemKey}.last_verified`, { date })
    || (EN_BUNDLE[`evidence.${itemKey}.last_verified`] ?? english).replace("{{date}}", date);
}

export { STATUS_COPY };
