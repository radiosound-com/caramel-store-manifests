import {
  CAPABILITIES,
  classifyError,
  detailViewModel,
  displayValue,
  errorMessage,
  formatBytes,
  labelFor,
  loadCatalog,
  loadPackage,
  catalogViewModel,
  safeHttpsUrl,
  text,
  upstreamEntries,
  versionLabel,
} from "./app-core.mjs";

const app = document.querySelector("#app");
let catalogCache = null;
let requestNumber = 0;

function clearApp() {
  app.replaceChildren();
}

function createElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function setText(element, value, fallback = "Not provided") {
  element.textContent = text(value, fallback);
}

function safeExternalLink(href, label, className = "inline-link") {
  const url = safeHttpsUrl(href);
  if (!url) return null;
  const link = createElement("a", className, label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  return link;
}

function showState(title, message, { error = false, retry = false, missing = false } = {}) {
  clearApp();
  const card = createElement("section", `state-card${error ? " error-card" : ""}`);
  if (error) card.setAttribute("role", "alert");
  card.append(
    createElement("p", "eyebrow", missing ? "Package not found" : error ? "Catalog unavailable" : "Caramel Store"),
    createElement("h1", null, title),
    createElement("p", null, message),
  );
  const actions = createElement("div", "state-actions");
  if (retry) {
    const retryButton = createElement("button", "button-link", "Try again");
    retryButton.type = "button";
    retryButton.addEventListener("click", () => route());
    actions.append(retryButton);
  }
  if (missing || error) {
    const back = createElement("a", "button-link secondary", "Back to catalog");
    back.href = "#/";
    actions.append(back);
  }
  if (actions.childElementCount) card.append(actions);
  app.append(card);
}

function freshnessBanner(catalog) {
  const freshness = catalogViewModel(catalog).freshness;
  if (!freshness.stale) return null;
  const banner = createElement("aside", "freshness-banner");
  banner.setAttribute("role", "status");
  banner.append(
    createElement("strong", null, "This catalog may be out of date"),
    createElement("span", null, `Generated ${freshness.generatedLabel}. Treat versions and links as stale until a newer revision is published.`),
  );
  return banner;
}

function freshnessStamp(catalog) {
  const freshness = catalogViewModel(catalog).freshness;
  const stamp = createElement("div", "freshness-stamp");
  stamp.append(
    createElement("span", "freshness-label", "Catalog freshness"),
    createElement("strong", null, freshness.generatedLabel),
  );
  const status = createElement("span", `freshness-status${freshness.stale ? " stale" : ""}`, freshness.status === "unknown" ? "Unknown" : freshness.label);
  stamp.append(status);
  return stamp;
}

function capabilityList(findings) {
  const list = createElement("ul", "capability-list");
  for (const [key, label] of CAPABILITIES) {
    const item = createElement("li", "capability-item");
    const detected = findings?.[key] === true;
    item.append(
      createElement("span", `capability-dot${detected ? " detected" : ""}`, ""),
      createElement("span", null, label),
      createElement("strong", detected ? "capability-yes" : "capability-no", detected ? "Detected" : "Not detected"),
    );
    list.append(item);
  }
  return list;
}

function entryCard(entry, stale) {
  const card = createElement("article", "app-card");
  const top = createElement("div", "card-top");
  const titleBlock = createElement("div");
  const link = createElement("a", null, text(entry.name || entry.app_name || entry.package_name));
  link.href = `#/package/${encodeURIComponent(entry.package_name)}`;
  const id = createElement("div", "app-id", text(entry.package_name));
  titleBlock.append(link, id);
  top.append(titleBlock, createElement("span", `badge${stale ? " stale" : ""}`, stale ? "Stale data" : "Reviewed"));
  card.append(top);

  const findings = entry.manifest_findings || {};
  const summary = findings.summary || findings.description || entry.summary;
  if (summary) card.append(createElement("p", null, summary));
  card.append(capabilityList(findings));

  const meta = createElement("div", "card-meta");
  meta.append(
    createElement("span", null, versionLabel(entry)),
    createElement("span", null, formatBytes(entry.downloaded_size)),
  );
  card.append(meta, createElement("div", "card-arrow", "View package →"));
  return card;
}

function renderCatalog(catalog) {
  const model = catalogViewModel(catalog);
  clearApp();

  const hero = createElement("section", "hero");
  hero.append(
    createElement("p", "eyebrow", "Caramel Vanilla"),
    createElement("h1", null, "A calmer app catalog."),
    createElement("p", null, "Browse applications reviewed for the Caramel Vanilla in-car experience, with links back to their upstream sources."),
  );
  app.append(hero);

  const freshness = freshnessBanner(catalog);
  if (freshness) app.append(freshness);

  if (!model.entries.length) {
    const empty = createElement("section", "state-card");
    empty.append(
      createElement("p", "eyebrow", "Catalog ready"),
      createElement("h2", null, "No approved applications yet"),
      createElement("p", null, "The catalog service is online. Applications will appear after the scanner publishes its next signed catalog."),
    );
    app.append(empty);
    return;
  }

  const toolbar = createElement("div", "toolbar");
  const label = createElement("label", "search-label");
  const search = document.createElement("input");
  search.className = "search";
  search.type = "search";
  search.placeholder = "Search by name or package ID";
  search.setAttribute("aria-label", "Search catalog");
  label.append(createElement("span", "sr-only", "Search catalog"), search);
  const count = createElement("span", "count");
  const toolbarMeta = createElement("div", "toolbar-meta");
  toolbarMeta.append(count, createElement("span", "freshness-inline", `Generated ${model.freshness.generatedLabel}`));
  toolbar.append(label, toolbarMeta);
  app.append(toolbar);

  const grid = createElement("section", "catalog-grid");
  grid.setAttribute("aria-label", "Application catalog");
  app.append(grid);

  const draw = () => {
    const filtered = catalogViewModel(catalog, search.value).visibleEntries;
    count.textContent = `${filtered.length} application${filtered.length === 1 ? "" : "s"}`;
    grid.replaceChildren(...filtered.map((entry) => entryCard(entry, model.freshness.stale)));
    if (!filtered.length) grid.append(createElement("p", "state-card", "No applications match that search."));
  };
  search.addEventListener("input", draw);
  draw();
}

function field(label, value, valueClass = "") {
  const wrapper = createElement("div", "detail-field");
  const list = document.createElement("dl");
  list.append(createElement("dt", null, label));
  const definition = createElement("dd", valueClass);
  if (value instanceof Node) definition.append(value);
  else setText(definition, value);
  list.append(definition);
  wrapper.append(list);
  return wrapper;
}

function renderFindings(findings) {
  const section = createElement("section", "detail-section");
  section.append(createElement("h2", null, "Manifest findings"));
  const entries = Object.entries(findings || {});
  if (!entries.length) {
    section.append(createElement("p", "empty-note", "No manifest findings reported."));
    return section;
  }
  const grid = createElement("dl", "findings-grid");
  for (const [key, value] of entries) {
    const item = createElement("div", "finding-item");
    item.append(createElement("dt", null, labelFor(key)), createElement("dd", null, displayValue(value)));
    grid.append(item);
  }
  section.append(grid);
  return section;
}

function renderCapabilities(findings) {
  const section = createElement("section", "detail-section");
  section.append(createElement("h2", null, "Automotive capabilities"), capabilityList(findings));
  return section;
}

function renderUpstreamLinks(entry) {
  const section = createElement("section", "detail-section");
  section.append(createElement("h2", null, "Upstream links"));
  const links = createElement("ul", "upstream-list");
  const upstream = upstreamEntries(entry.upstream_urls || {});
  const apk = safeHttpsUrl(entry.canonical_apk_url || entry.apk_url);
  if (apk) upstream.unshift({ label: "APK artifact", url: apk });
  const seenUrls = new Set();
  for (const item of upstream) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    const row = createElement("li", "upstream-item");
    const link = safeExternalLink(item.url, item.url, "upstream-url");
    row.append(createElement("span", "upstream-label", item.label), link);
    links.append(row);
  }
  if (!links.childElementCount) section.append(createElement("p", "empty-note", "No upstream links reported."));
  else section.append(links);
  return section;
}

function renderDetailView(entry, catalog) {
  const model = detailViewModel(entry, catalog);
  clearApp();
  const back = createElement("a", "back-link", "← Back to catalog");
  back.href = "#/";
  const card = createElement("article", "detail-card");
  const heading = createElement("div", "detail-heading");
  const titleBlock = createElement("div");
  titleBlock.append(
    createElement("p", "eyebrow", "Reviewed application"),
    createElement("h1", null, text(entry.name || entry.app_name || entry.package_name)),
    createElement("div", "app-id", text(entry.package_name)),
  );
  heading.append(titleBlock, createElement("span", "badge", "Reviewed"), freshnessStamp(catalog));
  card.append(heading);

  const findings = model.findings;
  const intro = findings.summary || findings.description || entry.summary;
  if (intro) card.append(createElement("p", "detail-intro", intro));

  const details = createElement("div", "detail-grid");
  details.append(
    field("Version", versionLabel(entry)),
    field("APK size", formatBytes(entry.downloaded_size)),
    field("SHA-256", entry.sha256, "hash-value"),
    field("APK URL", safeExternalLink(entry.canonical_apk_url || entry.apk_url, "Open APK upstream ↗", "inline-link")),
  );
  card.append(details, renderCapabilities(findings), renderFindings(findings), renderUpstreamLinks(entry));
  app.append(back, card);
}

async function renderCatalogPage() {
  const request = ++requestNumber;
  showState("Finding approved applications…", "Checking the latest public catalog revision.");
  try {
    const catalog = await loadCatalog();
    if (request !== requestNumber) return;
    catalogCache = catalog;
    renderCatalog(catalog);
  } catch (error) {
    if (request !== requestNumber) return;
    showState("We could not load the catalog", errorMessage(error), { error: true, retry: true });
  }
}

async function renderDetail(packageName) {
  const request = ++requestNumber;
  showState("Loading package…", "Fetching the published package details.");
  const catalogPromise = catalogCache ? Promise.resolve(catalogCache) : loadCatalog().catch(() => null);
  try {
    const [entry, catalog] = await Promise.all([loadPackage(globalThis.fetch, packageName), catalogPromise]);
    if (request !== requestNumber) return;
    renderDetailView(entry, catalog);
  } catch (error) {
    if (request !== requestNumber) return;
    if (classifyError(error, "detail") === "missing") {
      showState("Nothing here yet", "That package is not in the public catalog or the link is out of date.", { error: true, missing: true });
    } else {
      showState("Could not load this package", errorMessage(error), { error: true, retry: true });
    }
  }
}

async function route() {
  const match = location.hash.match(/^#\/package\/([^/]+)$/);
  if (match) {
    let packageName;
    try {
      packageName = decodeURIComponent(match[1]);
    } catch {
      showState("Package not found", "That package link is invalid.", { error: true, missing: true });
      return;
    }
    await renderDetail(packageName);
    return;
  }
  await renderCatalogPage();
}

window.addEventListener("hashchange", route);
route();
