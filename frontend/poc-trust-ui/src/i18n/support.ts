import { useEffect, useState } from "react";
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type LocaleCode } from "./locales";

/**
 * Translation review state (spec sections 6–8), derived from REAL catalog metadata —
 * the language menu and preview labels are computed, never hard-coded.
 *
 * Meta files (src/i18n/meta/<locale>.json) carry per-key review status, provenance and the
 * hash of the English source string each translation was based on (so an English change
 * reverts affected translations to "draft — needs re-review"). Meta loads lazily, the same
 * way catalogs do, so it never weighs on first paint.
 */

export type SupportState = "supported" | "preview";

export interface CatalogMetaEntry {
  status: "draft" | "in_review" | "reviewed";
  source: "human" | "machine_draft" | "machine_edited";
  reviewer?: string;
  reviewed_at?: string;
  source_hash: string;
}

export type CatalogMeta = Record<string, CatalogMetaEntry>;

export interface LocaleSupport {
  state: SupportState;
  reviewed: number;
  total: number;
  /** True while any displayed string in this locale is still a draft (drives preview labels). */
  hasDrafts: boolean;
  version: number;
}

const metaCache = new Map<LocaleCode, Promise<CatalogMeta>>();

export function loadMeta(locale: LocaleCode): Promise<CatalogMeta> {
  if (locale === FALLBACK_LOCALE) {
    return import("./meta/en-ZA.json").then((m) => m.default as unknown as CatalogMeta);
  }
  let pending = metaCache.get(locale);
  if (!pending) {
    pending = import(`./meta/${locale}.json`)
      .then((m) => m.default as unknown as CatalogMeta)
      .catch((err) => {
        metaCache.delete(locale); // retry when connectivity returns — never cache a failure
        throw err;
      });
    metaCache.set(locale, pending);
  }
  return pending;
}

export function summarise(meta: CatalogMeta): LocaleSupport {
  // The version marker is not a reviewable entry — count real translation keys only.
  const keys = Object.entries(meta).filter(([k]) => k !== "version");
  const reviewed = keys.filter(([, e]) => e?.status === "reviewed").length;
  return {
    state: keys.length > 0 && reviewed === keys.length ? "supported" : "preview",
    reviewed,
    total: keys.length,
    hasDrafts: keys.some(([, e]) => e?.status !== "reviewed"),
    version: Number((meta as Record<string, unknown>).version ?? 1) || 1,
  };
}

/** Load support summaries for every supported locale (one meta fetch each, cached). */
export async function loadAllSupport(): Promise<Record<LocaleCode, LocaleSupport>> {
  const entries = await Promise.all(
    SUPPORTED_LOCALES.map(async (l) => [l.code, summarise(await loadMeta(l.code))] as const),
  );
  return Object.fromEntries(entries) as Record<LocaleCode, LocaleSupport>;
}

/** Honest default while meta is still loading: assume drafts until proven reviewed. */
const PENDING: LocaleSupport = { state: "preview", reviewed: 0, total: 0, hasDrafts: true, version: 1 };

/** React hook: support summaries for the language menu / preview labels. */
export function useLocaleSupport(): Record<LocaleCode, LocaleSupport> | null {
  const [support, setSupport] = useState<Record<LocaleCode, LocaleSupport> | null>(null);
  useEffect(() => {
    let live = true;
    loadAllSupport().then((s) => live && setSupport(s)).catch(() => live && setSupport(null));
    return () => { live = false; };
  }, []);
  return support;
}

export { PENDING as PENDING_SUPPORT };
