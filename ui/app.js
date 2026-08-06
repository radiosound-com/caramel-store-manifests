const app = document.querySelector("#app");
const catalogPath = "/v1/catalog";

function clearApp() {
  app.replaceChildren();
}

function text(value, fallback = "Not provided") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function formatBytes(value) {
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

function versionLabel(entry) {
  const findings = entry.manifest_findings || {};
  const version = findings.version_name || entry.version_name || entry.version;
  const code = entry.version_code || findings.version_code;
  if (version && code) return `${version} (${code})`;
  return text(version || code, "Version unavailable");
}

function createElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function linkElement(href, label, secondary = false) {
  const link = createElement("a", `button-link${secondary ? " secondary" : ""}`, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  return link;
}

async function getJson(path) {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
  return response.json();
}

function showState(title, message, error = false) {
  clearApp();
  const card = createElement("section", `state-card${error ? " error-card" : ""}`);
  card.append(
    createElement("p", "eyebrow", error ? "Catalog unavailable" : "Caramel Store"),
    createElement("h1", null, title),
    createElement("p", null, message),
  );
  app.append(card);
}

function entryCard(entry) {
  const card = createElement("article", "app-card");
  const top = createElement("div", "card-top");
  const titleBlock = createElement("div");
  const link = createElement("a", null, text(entry.name || entry.app_name || entry.package_name));
  link.href = `#/package/${encodeURIComponent(entry.package_name)}`;
  const id = createElement("div", "app-id", text(entry.package_name));
  titleBlock.append(link, id);
  top.append(titleBlock, createElement("span", "badge", "Reviewed"));
  card.append(top);

  const findings = entry.manifest_findings || {};
  const summary = findings.summary || findings.description || entry.summary;
  if (summary) card.append(createElement("p", null, summary));

  const meta = createElement("div", "card-meta");
  meta.append(
    createElement("span", null, versionLabel(entry)),
    createElement("span", null, formatBytes(entry.downloaded_size)),
  );
  card.append(meta, createElement("div", "card-arrow", "View package →"));
  return card;
}

function renderCatalog(catalog) {
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  clearApp();

  const hero = createElement("section", "hero");
  hero.append(
    createElement("p", "eyebrow", "Caramel Vanilla"),
    createElement("h1", null, "A calmer app catalog."),
    createElement("p", null, "Browse applications reviewed for the Caramel Vanilla in-car experience, with links back to their upstream sources."),
  );
  app.append(hero);

  if (!entries.length) {
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
  const search = document.createElement("input");
  search.className = "search";
  search.type = "search";
  search.placeholder = "Search by name or package ID";
  search.setAttribute("aria-label", "Search catalog");
  const count = createElement("span", "count");
  toolbar.append(search, count);
  app.append(toolbar);

  const grid = createElement("section", "catalog-grid");
  grid.setAttribute("aria-label", "Application catalog");
  app.append(grid);

  const draw = () => {
    const query = search.value.trim().toLowerCase();
    const visible = entries.filter((entry) => {
      const haystack = `${entry.name || ""} ${entry.app_name || ""} ${entry.package_name || ""}`.toLowerCase();
      return haystack.includes(query);
    });
    count.textContent = `${visible.length} application${visible.length === 1 ? "" : "s"}`;
    grid.replaceChildren(...visible.map(entryCard));
    if (!visible.length) grid.append(createElement("p", "state-card", "No applications match that search."));
  };
  search.addEventListener("input", draw);
  draw();
}

function field(label, value) {
  const wrapper = createElement("div", "detail-field");
  const list = document.createElement("dl");
  list.append(createElement("dt", null, label), createElement("dd", null, text(value)));
  wrapper.append(list);
  return wrapper;
}

async function renderDetail(packageName) {
  clearApp();
  const loading = createElement("section", "state-card");
  loading.append(createElement("p", "eyebrow", "Package details"), createElement("h1", null, "Loading package…"));
  app.append(loading);

  try {
    const entry = await getJson(`${catalogPath}/${encodeURIComponent(packageName)}`);
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
    heading.append(titleBlock, createElement("span", "badge", "Reviewed"));
    card.append(heading);

    const findings = entry.manifest_findings || {};
    const intro = findings.summary || findings.description || entry.summary;
    if (intro) card.append(createElement("p", "detail-intro", intro));

    const details = createElement("div", "detail-grid");
    details.append(
      field("Version", versionLabel(entry)),
      field("APK size", formatBytes(entry.downloaded_size)),
      field("SHA-256", entry.sha256),
      field("Compatibility", findings.automotive_candidate === false ? "Needs review" : "Automotive candidate"),
    );
    card.append(details);

    const links = createElement("div", "links");
    const upstream = entry.canonical_apk_url || entry.apk_url;
    if (upstream) links.append(linkElement(upstream, "Upstream artifact"));
    const source = (entry.upstream_urls || {}).sourceCode || (entry.upstream_urls || {}).source_code;
    if (source) links.append(linkElement(source, "Source code", true));
    if (links.childElementCount) card.append(links);
    app.append(back, card);
  } catch (error) {
    showState("Package not available", error.message, true);
  }
}

async function route() {
  const match = location.hash.match(/^#\/package\/(.+)$/);
  if (match) {
    await renderDetail(decodeURIComponent(match[1]));
    return;
  }
  try {
    renderCatalog(await getJson(catalogPath));
  } catch (error) {
    showState("We could not load the catalog", error.message, true);
  }
}

window.addEventListener("hashchange", route);
route();
