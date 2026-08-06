export const CATALOG_PATH = "/v1/catalog";
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

export function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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

export function catalogViewModel(catalog, query = "") {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const normalizedQuery = String(query).trim().toLowerCase();
  const visibleEntries = entries.filter((entry) => {
    const haystack = `${entry.name || ""} ${entry.app_name || ""} ${entry.package_name || ""} ${versionLabel(entry)}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
  return {
    entries,
    visibleEntries,
    freshness: catalogFreshness(catalog?.generated_at),
    source: text(catalog?.source, "Public catalog"),
  };
}

export function detailViewModel(entry, catalog = null) {
  return {
    entry,
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

export async function loadPackage(fetchImpl = globalThis.fetch, packageName) {
  const entry = await requestJson(fetchImpl, `${CATALOG_PATH}/${encodeURIComponent(packageName)}`);
  if (!entry || typeof entry.package_name !== "string") {
    throw new ApiError("The package response was invalid.");
  }
  return entry;
}
