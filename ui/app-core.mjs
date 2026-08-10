export const CATALOG_PATH = "/v1/catalog";
export const RANKINGS_PATH = "/v1/rankings";
export const FIRST_PARTY_INDEX_PATH = "/fdroid/repo/caramel-index-v1.json";
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export const CAPABILITIES = [
  ["automotive_candidate", "Automotive candidate"],
  ["automotive_feature", "Automotive feature"],
  ["car_app_service", "Car app service"],
];

export const CAPABILITY_EXPLANATIONS = {
  automotive_candidate: "Broad scanner gate: at least one Automotive-related manifest signal was found.",
  automotive_feature: "The APK declares Android's android.hardware.type.automotive feature.",
  car_app_service: "The APK contains an AndroidX for Cars CarAppService signal.",
};

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function text(value, fallback = "Not provided") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 1) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let amount = bytes;
  let unit = "B";
  for (const next of units) {
    amount /= 1024;
    unit = next;
    if (amount < 1024 || next === units.at(-1)) break;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`;
}

export function versionLabel(entry) {
  const findings = entry?.manifest_findings || {};
  const version = findings.version_name || entry?.version_name || entry?.version;
  const code = entry?.version_code || findings.version_code;
  if (version && code) return `${version} (${code})`;
  return text(version || code, "Version unavailable");
}

export function statusLabel(entry, stale = false) {
  if (entry?.first_party) return "Caramel release";
  if (stale) return "Stale data";
  return "";
}

export function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function entryUpdatedAt(entry) {
  const value = entry?.metadata?.last_updated;
  const timestamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isRecentlyUpdated(entry, now = Date.now(), maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  const updatedAt = entryUpdatedAt(entry);
  return updatedAt !== null && updatedAt <= now && now - updatedAt <= maxAgeMs;
}

function validRanking(value) {
  if (!value || typeof value !== "object") return null;
  const rank = Number(value.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 1_000_000) return null;
  return {
    source: text(value.source, "Caramel Store aggregate"),
    rank,
    period: text(value.period, ""),
  };
}

export function entryRanking(entry, rankings = []) {
  const metadataRanking = validRanking(entry?.metadata?.ranking);
  if (metadataRanking) return metadataRanking;
  const external = Array.isArray(rankings)
    ? rankings.find((item) => item?.package_name === entry?.package_name)
    : null;
  return validRanking(external ? { ...external, source: external.source || "Caramel Store aggregate" } : null);
}

export function catalogFreshness(generatedAt, now = Date.now()) {
  const timestamp = new Date(generatedAt).getTime();
  if (Number.isNaN(timestamp)) {
    return { status: "unknown", stale: false, label: "Freshness unavailable", generatedLabel: "Unknown" };
  }
  const stale = now - timestamp > STALE_AFTER_MS;
  return {
    status: stale ? "stale" : "current",
    stale,
    label: stale ? "Stale catalog data" : "Catalog current",
    generatedLabel: formatDate(generatedAt),
  };
}

export function isCatalogStale(generatedAt, now = Date.now()) {
  return catalogFreshness(generatedAt, now).stale;
}

export function safeHttpsUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function cacheBustedUrl(value, revision) {
  const url = safeHttpsUrl(value);
  if (!url || revision === undefined || revision === null || revision === "") return url;
  const parsed = new URL(url);
  parsed.searchParams.set("caramel_revision", String(revision));
  return parsed.href;
}

export function labelFor(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}

export function displayValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "Not reported";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function capabilityValues(findings = {}) {
  return CAPABILITIES.map(([key, label]) => ({
    key,
    label,
    detected: findings[key] === true,
  }));
}

export function upstreamEntries(upstreamUrls = {}) {
  return Object.entries(upstreamUrls)
    .map(([key, value]) => ({ key, label: labelFor(key), url: safeHttpsUrl(value) }))
    .filter((entry) => entry.url);
}

export function catalogViewModel(catalog, query = "", now = Date.now(), rankings = []) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const normalizedQuery = String(query).trim().toLowerCase();
  const visibleEntries = entries.filter((entry) => {
    const metadata = entry.metadata || {};
    const haystack = `${metadata.display_name || ""} ${metadata.summary || ""} ${entry.name || ""} ${entry.app_name || ""} ${entry.package_name || ""} ${versionLabel(entry)}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
  const recentEntries = entries
    .filter((entry) => isRecentlyUpdated(entry, now))
    .sort((left, right) => entryUpdatedAt(right) - entryUpdatedAt(left));
  const rankedEntries = entries
    .map((entry) => ({ entry, ranking: entryRanking(entry, rankings) }))
    .filter((item) => item.ranking)
    .sort((left, right) => left.ranking.rank - right.ranking.rank);
  return {
    entries,
    visibleEntries,
    recentEntries,
    rankedEntries,
    freshness: catalogFreshness(catalog?.generated_at, now),
    source: text(catalog?.source, "Public catalog"),
  };
}

export function mergeCatalogs(publicCatalog, firstPartyCatalog, notice = "") {
  const entries = new Map();
  for (const catalog of [publicCatalog, firstPartyCatalog]) {
    for (const entry of catalog?.entries || []) {
      if (entry?.package_name) entries.set(entry.package_name, entry);
    }
  }
  const sorted = [...entries.values()].sort((left, right) =>
    entryName(left).localeCompare(entryName(right), undefined, { sensitivity: "base" }),
  );
  const generatedAt = [publicCatalog?.generated_at, firstPartyCatalog?.generated_at]
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const source = [publicCatalog?.source, firstPartyCatalog?.source]
    .filter(Boolean)
    .join(" + ") || "Caramel Store";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    source,
    entries: sorted,
    notice,
  };
}

function entryName(entry) {
  const metadata = entry?.metadata || {};
  return String(metadata.display_name || entry?.name || entry?.app_name || entry?.package_name || "");
}

export function detailViewModel(entry, catalog = null) {
  return {
    entry,
    metadata: entry?.metadata || {},
    findings: entry?.manifest_findings || {},
    capabilities: capabilityValues(entry?.manifest_findings || {}),
    upstream: upstreamEntries(entry?.upstream_urls || {}),
    freshness: catalogFreshness(catalog?.generated_at),
  };
}

export function classifyError(error, view = "catalog") {
  if (view === "detail" && error?.status === 404) return "missing";
  return "error";
}

export function errorMessage(error) {
  if (error?.status === 404) return "The requested resource was not found.";
  if (error instanceof TypeError) {
    return "The catalog API could not be reached. Check the same-origin deployment or try again.";
  }
  return error?.message || "The catalog API returned an unexpected error.";
}

export async function requestJson(fetchImpl, path) {
  const response = await fetchImpl(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The HTTP status remains useful when a proxy returns non-JSON.
  }
  if (!response.ok) {
    throw new ApiError(body?.error || `Catalog request failed (${response.status})`, response.status);
  }
  return body;
}

export async function loadCatalog(fetchImpl = globalThis.fetch) {
  const catalog = await requestJson(fetchImpl, CATALOG_PATH);
  if (!catalog || !Array.isArray(catalog.entries)) {
    throw new ApiError("The catalog API returned an invalid catalog.");
  }
  return catalog;
}

export async function loadRankings(fetchImpl = globalThis.fetch) {
  const rankings = await requestJson(fetchImpl, RANKINGS_PATH);
  if (!rankings || !Array.isArray(rankings.entries)) {
    throw new ApiError("The rankings API returned an invalid response.");
  }
  return rankings;
}

export async function loadFirstPartyCatalog(fetchImpl = globalThis.fetch) {
  const index = await requestJson(fetchImpl, FIRST_PARTY_INDEX_PATH);
  if (!index || !Array.isArray(index.packages)) {
    throw new ApiError("The first-party repository returned an invalid index.");
  }
  return {
    schema_version: index.schema_version,
    generated_at: index.generated_at,
    source: index.repository?.name || "Caramel App Repository",
    entries: index.packages,
  };
}

export async function loadCombinedCatalog(fetchImpl = globalThis.fetch) {
  const results = await Promise.allSettled([
    loadCatalog(fetchImpl),
    loadFirstPartyCatalog(fetchImpl),
  ]);
  const publicCatalog = results[0].status === "fulfilled" ? results[0].value : null;
  const firstPartyCatalog = results[1].status === "fulfilled" ? results[1].value : null;
  if (!publicCatalog && !firstPartyCatalog) {
    throw results[0].reason || results[1].reason || new ApiError("No catalog source could be reached.");
  }
  const failedSources = [];
  if (!publicCatalog) failedSources.push("curated catalog");
  if (!firstPartyCatalog) failedSources.push("Caramel releases");
  const notice = failedSources.length
    ? `${failedSources.join(" and ")} could not be checked. Available catalog entries are still shown.`
    : "";
  return mergeCatalogs(publicCatalog, firstPartyCatalog, notice);
}

export async function loadPackage(fetchImpl = globalThis.fetch, packageName) {
  const entry = await requestJson(fetchImpl, `${CATALOG_PATH}/${encodeURIComponent(packageName)}`);
  if (!entry || typeof entry.package_name !== "string") {
    throw new ApiError("The package response was invalid.");
  }
  return entry;
}
