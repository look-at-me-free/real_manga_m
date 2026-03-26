(() => {
  "use strict";

  // /notes
  // ------------------------------------------------------------------
  // PHILOSOPHY
  // library.json remains the upload-friendly physical truth.
  // search_maps/*.json are semantic overlays.
  //
  // This file is built to grow toward an endless branching system:
  // - stable archive layer
  // - map layer
  // - future semantic layers
  // - future page/region/annotation/relationship layers
  //
  // IMPORTANT:
  // No use_map field => false
  // Only explicit use_map: true activates a map.
  // ------------------------------------------------------------------

  const CONFIG = {
    libraryFile: "library.json",
    mapsBasePath: "search_maps",
    defaultWorksBase: "https://pub-cd01009a7c6c464aa0b093e33aa5ae51.r2.dev/works",
    itemJsonName: "item.json",
    searchResultsLimit: 12
  };

  const ERROR_CODES = {
    LIBRARY_FETCH_FAILED: "LIBRARY_FETCH_FAILED",
    LIBRARY_INVALID: "LIBRARY_INVALID",
    NO_WORKS_FOUND: "NO_WORKS_FOUND",
    MAP_FETCH_FAILED: "MAP_FETCH_FAILED",
    MAP_INVALID: "MAP_INVALID",
    SEARCH_INDEX_BUILD_FAILED: "SEARCH_INDEX_BUILD_FAILED",
    SELECTION_NOT_FOUND: "SELECTION_NOT_FOUND",
    MANIFEST_FETCH_FAILED: "MANIFEST_FETCH_FAILED",
    MANIFEST_INVALID: "MANIFEST_INVALID",
    MANIFEST_NO_BASE_URL: "MANIFEST_NO_BASE_URL",
    MANIFEST_NO_IMAGES: "MANIFEST_NO_IMAGES",
    SWITCH_ENTRY_FAILED: "SWITCH_ENTRY_FAILED",
    BUILD_READER_FAILED: "BUILD_READER_FAILED",
    BOOT_FAILED: "BOOT_FAILED"
  };

  const STATE = {
    works: [],
    sourceMap: {},

    currentWork: null,
    currentEntry: null,
    currentItem: null,

    isMobileReader: document.body?.dataset?.readerMode === "mobile",

    searchWired: false,
    topFlyoutsWired: false,
    stickyControlsWired: false,
    mobileWorksWired: false,
    progressWatchWired: false,
    dialWired: false,

    mobileOpenWorkSlug: "",

    workMaps: new Map(),     // work slug -> map object or null
    searchRows: [],          // merged search index
    futureLayers: new Map()  // reserved for future branch layers
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function createEl(tag, className = "", text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function normalizeKey(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function normalizeBaseUrl(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function titleCaseSlug(slug) {
    return String(slug ?? "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  function createAppError(code, message, details = {}) {
    const err = new Error(message);
    err.name = "AppError";
    err.code = code;
    err.details = details;
    return err;
  }

  function logAppError(err, context = "") {
    const code = err?.code || "UNEXPECTED_ERROR";
    const message = err?.message || "Unexpected failure";
    console.error(`[${code}]${context ? ` ${context}` : ""}: ${message}`, err?.details || {}, err);
    return { code, message, details: err?.details || null };
  }

  function showFatalError(err) {
    const payload = logAppError(err, "Fatal");

    const workTitleEl = document.getElementById("workTitle");
    if (workTitleEl) workTitleEl.textContent = `Failed to load (${payload.code})`;

    const reader = document.getElementById("reader");
    if (reader) {
      reader.innerHTML = `
        <div class="note">
          <strong>Error code:</strong> ${escapeHtml(payload.code)}<br>
          <strong>Message:</strong> ${escapeHtml(payload.message)}<br>
          Check library.json, search_maps, sources, item.json, base_url, and image filenames.
        </div>
      `;
    }

    const stat = document.getElementById("chapterSearchStat");
    if (stat) stat.textContent = `Error: ${payload.code}`;
  }

  function validateLibrary(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw createAppError(ERROR_CODES.LIBRARY_INVALID, "library.json is not a valid object");
    }

    if (!Array.isArray(data.works)) {
      throw createAppError(ERROR_CODES.LIBRARY_INVALID, "library.json missing works array");
    }

    if (!data.works.length) {
      throw createAppError(ERROR_CODES.NO_WORKS_FOUND, "library.json has no works");
    }

    return data;
  }

  async function loadLibrary() {
    let data;
    try {
      data = await fetchJson(CONFIG.libraryFile);
    } catch (err) {
      throw createAppError(
        ERROR_CODES.LIBRARY_FETCH_FAILED,
        "Failed to fetch library.json",
        { cause: err.message }
      );
    }

    const validated = validateLibrary(data);

    STATE.works = validated.works.filter(work => work && typeof work === "object");
    STATE.sourceMap = validated.sources && typeof validated.sources === "object"
      ? validated.sources
      : {};

    if (!STATE.works.length) {
      throw createAppError(ERROR_CODES.NO_WORKS_FOUND, "No valid works found in library.json");
    }
  }

  function shouldUseMap(work) {
    return work?.use_map === true;
  }

  function getMapFile(work) {
    if (!shouldUseMap(work)) return null;
    const fileName = work.map_file || `${work.slug}.json`;
    return `${CONFIG.mapsBasePath}/${fileName}`;
  }

  function getWorkMap(workOrSlug) {
    const slug = typeof workOrSlug === "string" ? workOrSlug : workOrSlug?.slug;
    return slug ? (STATE.workMaps.get(slug) || null) : null;
  }

  function validateMapData(work, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw createAppError(
        ERROR_CODES.MAP_INVALID,
        `Map for ${work.slug} is not a valid object`,
        { work: work.slug }
      );
    }
    return data;
  }

  async function loadWorkMap(work) {
    if (!shouldUseMap(work)) return null;

    if (STATE.workMaps.has(work.slug)) {
      return STATE.workMaps.get(work.slug);
    }

    const url = getMapFile(work);

    try {
      const data = await fetchJson(url);
      const validated = validateMapData(work, data);
      STATE.workMaps.set(work.slug, validated);
      return validated;
    } catch (err) {
      logAppError(
        createAppError(
          err.code === ERROR_CODES.MAP_INVALID ? ERROR_CODES.MAP_INVALID : ERROR_CODES.MAP_FETCH_FAILED,
          `Failed to load map for ${work.slug}`,
          { work: work.slug, url, cause: err.message }
        ),
        "Map load"
      );

      // non-fatal fallback
      STATE.workMaps.set(work.slug, null);
      return null;
    }
  }

  async function loadAllWorkMaps() {
    const mappedWorks = STATE.works.filter(shouldUseMap);
    await Promise.all(mappedWorks.map(loadWorkMap));
  }

  function resolveSourceKey(work, entry) {
    return entry?.source || work?.source || "";
  }

  function getSourceBaseByKey(sourceKey) {
    return sourceKey ? normalizeBaseUrl(STATE.sourceMap[sourceKey] || "") : "";
  }

  function getWorkBase(work, entry) {
    return normalizeBaseUrl(
      entry?.base_url ||
      getSourceBaseByKey(resolveSourceKey(work, entry)) ||
      work?.base_url ||
      CONFIG.defaultWorksBase
    );
  }

  function getItemJsonUrl(work, entry) {
    if (entry?.item_url) return entry.item_url;

    const path = String(entry?.path || entry?.slug || "");
    const parts = path.split("/").filter(Boolean).map(part => encodeURIComponent(part));

    return `${getWorkBase(work, entry)}/${encodeURIComponent(work.slug)}/${parts.join("/")}/${CONFIG.itemJsonName}`;
  }

  function resolveSelection(dir, file) {
    const work = STATE.works.find(w => normalizeKey(w.slug) === normalizeKey(dir));
    if (!work) return null;

    const entry = (work.entries || []).find(e => normalizeKey(e.slug) === normalizeKey(file));
    if (!entry) return null;

    return { work, entry };
  }

  function getChapterLocationForEntry(work, entry) {
    const map = getWorkMap(work);
    return map?.chapter_locations?.[entry.slug] || null;
  }

  function getEntryDisplayLabel(work, entry) {
    const mapped = getChapterLocationForEntry(work, entry);
    return mapped?.display_label || entry.subtitle || titleCaseSlug(entry.slug);
  }

  function makeSearchRow(row) {
    return {
      type: row.type || "entry",
      workSlug: row.workSlug,
      workLabel: row.workLabel,
      entrySlug: row.entrySlug || "",
      entryLabel: row.entryLabel || "",
      subLabel: row.subLabel || "",
      page: row.page ?? null,
      zoneId: row.zoneId ?? null,
      searchKey: normalizeKey(row.searchKey || "")
    };
  }

  function flattenEntries() {
    const rows = [];

    try {
      for (const work of STATE.works) {
        const workLabel = work.display || titleCaseSlug(work.slug);
        const workMap = getWorkMap(work);

        for (const entry of work.entries || []) {
          const chapterMeta = workMap?.chapter_locations?.[entry.slug] || null;
          const entryLabel = getEntryDisplayLabel(work, entry);

          rows.push(makeSearchRow({
            type: "entry",
            workSlug: work.slug,
            workLabel,
            entrySlug: entry.slug,
            entryLabel,
            subLabel: entry.subtitle || "",
            searchKey: [
              workLabel,
              entry.slug,
              entry.subtitle || "",
              chapterMeta?.display_label || "",
              ...(chapterMeta?.search_terms || [])
            ].join(" ")
          }));
        }

        if (!workMap) continue;

        for (const [entrySlug, meta] of Object.entries(workMap.chapter_locations || {})) {
          rows.push(makeSearchRow({
            type: "chapter",
            workSlug: work.slug,
            workLabel,
            entrySlug,
            entryLabel: meta.display_label || `Chapter ${meta.chapter_start || ""}`.trim(),
            subLabel: "Mapped chapter location",
            searchKey: [
              workLabel,
              meta.display_label || "",
              ...(meta.chapter_numbers || []).map(n => `chapter ${n}`),
              ...(meta.search_terms || [])
            ].join(" ")
          }));
        }

        for (const arc of (workMap.arcs || [])) {
          rows.push(makeSearchRow({
            type: "arc",
            workSlug: work.slug,
            workLabel,
            entrySlug: arc.target_entry_slug || arc.entry_slugs?.[0] || "",
            entryLabel: arc.label || "Arc",
            subLabel: `Arc · Chapters ${arc.chapter_start ?? "?"}–${arc.chapter_end ?? "?"}`,
            searchKey: [
              workLabel,
              arc.label || "",
              ...(arc.search_terms || [])
            ].join(" ")
          }));
        }

        for (const semantic of (workMap.semantic_links || [])) {
          rows.push(makeSearchRow({
            type: semantic.type || "tag_cluster",
            workSlug: work.slug,
            workLabel,
            entrySlug: semantic.entry_slug || "",
            entryLabel: semantic.label || "Semantic cluster",
            subLabel: semantic.summary || "Semantic cluster",
            searchKey: [
              workLabel,
              semantic.label || "",
              semantic.summary || "",
              ...(semantic.tags || []),
              ...(semantic.search_terms || [])
            ].join(" ")
          }));
        }

        for (const anno of (workMap.image_annotations || [])) {
          rows.push(makeSearchRow({
            type: "annotation",
            workSlug: work.slug,
            workLabel,
            entrySlug: anno.entry_slug || "",
            entryLabel: anno.label || "Annotation",
            subLabel: `Page ${anno.page ?? "?"}${anno.layer ? ` · ${anno.layer}` : ""}`,
            page: anno.page ?? null,
            zoneId: anno.id || null,
            searchKey: [
              workLabel,
              anno.label || "",
              anno.summary || "",
              ...(anno.tags || []),
              ...(anno.search_terms || [])
            ].join(" ")
          }));
        }
      }

      return rows;
    } catch (err) {
      throw createAppError(
        ERROR_CODES.SEARCH_INDEX_BUILD_FAILED,
        "Failed to build search index",
        { cause: err.message }
      );
    }
  }

  function rebuildSearchIndex() {
    STATE.searchRows = flattenEntries();
  }

  function renderSearchResults(items) {
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    if (!results || !stat) return;

    if (!items.length) {
      results.innerHTML = "";
      stat.textContent = STATE.isMobileReader ? "Type to search" : "No matches";
      return;
    }

    stat.textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;

    results.innerHTML = items.map(item => `
      <button
        class="search-result-pill search-result-pill--${escapeHtml(item.type)}"
        type="button"
        data-dir="${escapeHtml(item.workSlug)}"
        data-file="${escapeHtml(item.entrySlug)}"
        data-page="${item.page ?? ""}"
        data-zone="${escapeHtml(item.zoneId || "")}"
      >
        <span class="search-result-main">${escapeHtml(item.workLabel)} · ${escapeHtml(item.entryLabel)}</span>
        ${item.subLabel ? `<span class="search-result-sub">${escapeHtml(item.subLabel)}</span>` : ""}
      </button>
    `).join("");
  }

  function syncSearchSeed() {
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    const input = document.getElementById("chapterSearchInput");
    if (!results || !stat || !input) return;

    if (input.value.trim()) return;

    if (STATE.isMobileReader) {
      results.innerHTML = "";
      stat.textContent = "Type to search";
      return;
    }

    const seeded = STATE.searchRows
      .filter(item => item.workSlug === STATE.currentWork?.slug)
      .slice(0, CONFIG.searchResultsLimit);

    renderSearchResults(seeded);
    stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
  }

  function wireSearch() {
    if (STATE.searchWired) return;
    STATE.searchWired = true;

    const input = document.getElementById("chapterSearchInput");
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    if (!input || !results || !stat) return;

    const refresh = () => {
      const query = normalizeKey(input.value);

      if (!query) {
        if (STATE.isMobileReader) {
          results.innerHTML = "";
          stat.textContent = "Type to search";
          return;
        }

        const seeded = STATE.searchRows
          .filter(item => item.workSlug === STATE.currentWork?.slug)
          .slice(0, CONFIG.searchResultsLimit);

        renderSearchResults(seeded);
        stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
        return;
      }

      const matched = STATE.searchRows
        .filter(item => item.searchKey.includes(query))
        .slice(0, CONFIG.searchResultsLimit);

      renderSearchResults(matched);
      stat.textContent = matched.length ? `${matched.length} result${matched.length === 1 ? "" : "s"}` : "No matches";
    };

    input.addEventListener("input", refresh);

    results.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-dir][data-file]");
      if (!btn) return;

      input.value = "";

      if (STATE.isMobileReader) {
        results.innerHTML = "";
        stat.textContent = "Type to search";
        setMobileOpenWork(btn.dataset.dir);
      }

      await switchEntry(btn.dataset.dir, btn.dataset.file, false, { actionSource: "search" });
    });

    refresh();
  }

  function setMobileOpenWork(workSlug) {
    STATE.mobileOpenWorkSlug = normalizeKey(workSlug || "");

    $$(".mobile-work-item").forEach(item => {
      const isOpen = normalizeKey(item.dataset.workSlug) === STATE.mobileOpenWorkSlug;
      item.classList.toggle("open", isOpen);
      item.classList.toggle("active", isOpen);
    });
  }

  function renderWorksNav() {
    const nav = document.getElementById("worksNav");
    if (!nav) return;

    if (STATE.isMobileReader) {
      let html = "";

      for (const work of STATE.works.filter(w => w.top_pill !== false)) {
        const isActiveWork = normalizeKey(work.slug) === normalizeKey(STATE.currentWork?.slug);
        const isOpen = normalizeKey(work.slug) === normalizeKey(STATE.mobileOpenWorkSlug || STATE.currentWork?.slug);
        const entries = Array.isArray(work.entries) ? work.entries : [];

        html += `
          <section class="mobile-work-item${isActiveWork ? " active" : ""}${isOpen ? " open" : ""}" data-work-slug="${escapeHtml(work.slug)}">
            <button class="mobile-work-trigger" type="button" data-work-toggle="${escapeHtml(work.slug)}">
              <span class="label">${escapeHtml(work.display || titleCaseSlug(work.slug))}</span>
              <span class="count">${entries.length} ${entries.length === 1 ? "chapter" : "chapters"}</span>
            </button>
            <div class="mobile-chapters">
        `;

        for (const entry of entries) {
          const active =
            isActiveWork && normalizeKey(entry.slug) === normalizeKey(STATE.currentEntry?.slug)
              ? " current"
              : "";

          html += `
            <button class="mobile-chapter-link${active}" type="button" data-dir="${escapeHtml(work.slug)}" data-file="${escapeHtml(entry.slug)}">
              ${escapeHtml(getEntryDisplayLabel(work, entry))}
            </button>
          `;
        }

        html += `</div></section>`;
      }

      nav.innerHTML = html;
      return;
    }

    let html = "";

    for (const work of STATE.works.filter(w => w.top_pill !== false)) {
      const isActive = normalizeKey(work.slug) === normalizeKey(STATE.currentWork?.slug);
      const entries = Array.isArray(work.entries) ? work.entries : [];

      html += `
        <div class="topworks-item${isActive ? " active" : ""}">
          <button class="topworks-trigger" type="button" data-work-toggle="${escapeHtml(work.slug)}">
            ${escapeHtml(work.display || titleCaseSlug(work.slug))}
          </button>
          <div class="topworks-flyout">
      `;

      for (const entry of entries) {
        const current =
          isActive && normalizeKey(entry.slug) === normalizeKey(STATE.currentEntry?.slug)
            ? " current"
            : "";

        html += `
          <button class="topworks-link${current}" type="button" data-dir="${escapeHtml(work.slug)}" data-file="${escapeHtml(entry.slug)}">
            ${escapeHtml(getEntryDisplayLabel(work, entry))}
          </button>
        `;
      }

      html += `</div></div>`;
    }

    nav.innerHTML = html;
  }

  function validateManifest(manifest, itemUrl) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw createAppError(ERROR_CODES.MANIFEST_INVALID, "item.json is not a valid object", { itemUrl });
    }

    const baseUrl = normalizeBaseUrl(manifest.base_url);
    if (!baseUrl) {
      throw createAppError(ERROR_CODES.MANIFEST_NO_BASE_URL, "item.json missing base_url", { itemUrl });
    }

    const images = buildImageList(manifest);
    if (!images.length) {
      throw createAppError(ERROR_CODES.MANIFEST_NO_IMAGES, "No images found in item.json", { itemUrl });
    }

    return { manifest, baseUrl, images };
  }

  function buildImageList(manifest) {
    if (Array.isArray(manifest.images) && manifest.images.length) return manifest.images;

    if (Number.isFinite(manifest.pages) && manifest.pages > 0) {
      const ext = manifest.extension || "jpg";
      const padding = Number.isFinite(manifest.padding) ? manifest.padding : 2;

      return Array.from({ length: manifest.pages }, (_, i) => {
        return `${String(i + 1).padStart(padding, "0")}.${ext}`;
      });
    }

    return [];
  }

  function buildChapterMeta(manifest, imageCount) {
    const meta = createEl("section", "chapter-meta");
    const row = createEl("div", "meta-row");

    const mapped = getChapterLocationForEntry(STATE.currentWork, STATE.currentEntry);
    const mappedLabel =
      mapped?.display_label ||
      manifest.subtitle ||
      STATE.currentEntry?.subtitle ||
      titleCaseSlug(STATE.currentEntry?.slug || "");

    const leftTag = createEl(
      "div",
      "chapter-tag",
      `${manifest.title || STATE.currentWork.display || titleCaseSlug(STATE.currentWork.slug)} · ${mappedLabel}`
    );

    const rightTag = createEl("div", "chapter-tag", `${imageCount} page${imageCount === 1 ? "" : "s"}`);

    row.appendChild(leftTag);
    row.appendChild(rightTag);
    meta.appendChild(row);

    return meta;
  }

  async function buildReader() {
    const reader = document.getElementById("reader");
    if (!reader) return;

    let selection = resolveSelectionFromQuery();
    if (!selection) {
      selection = resolveDefaultSelection();
    }

    if (!selection) {
      throw createAppError(ERROR_CODES.SELECTION_NOT_FOUND, "Could not resolve current work/entry");
    }

    STATE.currentWork = selection.work;
    STATE.currentEntry = selection.entry;

    const itemUrl = getItemJsonUrl(selection.work, selection.entry);

    let rawManifest;
    try {
      rawManifest = await fetchJson(itemUrl);
    } catch (err) {
      throw createAppError(
        ERROR_CODES.MANIFEST_FETCH_FAILED,
        "Failed to fetch item.json",
        { itemUrl, cause: err.message, work: selection.work.slug, entry: selection.entry.slug }
      );
    }

    const { manifest, baseUrl, images } = validateManifest(rawManifest, itemUrl);
    STATE.currentItem = manifest;

    const workTitleEl = document.getElementById("workTitle");
    if (workTitleEl) {
      workTitleEl.textContent = `${selection.work.display || titleCaseSlug(selection.work.slug)} · ${getEntryDisplayLabel(selection.work, selection.entry)}`;
    }

    renderWorksNav();
    syncSearchSeed();

    reader.innerHTML = "";
    reader.appendChild(buildChapterMeta(manifest, images.length));

    for (let i = 0; i < images.length; i += 1) {
      const imageWrap = createEl("article", "image-wrap");
      const img = new Image();
      img.loading = i < 2 ? "eager" : "lazy";
      img.decoding = "async";
      img.src = `${baseUrl}/${images[i]}`;
      img.alt = `${selection.work.display || selection.work.slug} · ${getEntryDisplayLabel(selection.work, selection.entry)} · Page ${i + 1}`;
      imageWrap.appendChild(img);
      reader.appendChild(imageWrap);
    }
  }

  function resolveDefaultSelection() {
    const work = STATE.works[0];
    const entry = work?.entries?.[0];
    return work && entry ? { work, entry } : null;
  }

  function resolveSelectionFromQuery() {
    const url = new URL(window.location.href);
    const dir = url.searchParams.get("dir");
    const file = url.searchParams.get("file");
    if (!dir || !file) return null;
    return resolveSelection(dir, file);
  }

  function setQueryState(dir, file, replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.set("dir", dir);
    url.searchParams.set("file", file);

    if (replace) {
      history.replaceState({}, "", url);
    } else {
      history.pushState({}, "", url);
    }
  }

  async function switchEntry(dir, file, replace = false, options = {}) {
    try {
      const selection = resolveSelection(dir, file);
      if (!selection) {
        throw createAppError(
          ERROR_CODES.SELECTION_NOT_FOUND,
          `Could not resolve selection for ${dir}/${file}`,
          { dir, file }
        );
      }

      setQueryState(dir, file, replace);
      await buildReader();
    } catch (err) {
      throw createAppError(
        ERROR_CODES.SWITCH_ENTRY_FAILED,
        "Failed to switch entry",
        { dir, file, cause: err.message, source: options.actionSource || "unknown" }
      );
    }
  }

  function wireWorksNavClicks() {
    document.addEventListener("click", async (e) => {
      const workToggle = e.target.closest("[data-work-toggle]");
      if (workToggle && STATE.isMobileReader) {
        setMobileOpenWork(workToggle.dataset.workToggle);
        return;
      }

      const chapterBtn = e.target.closest("button[data-dir][data-file]");
      if (!chapterBtn) return;

      await switchEntry(chapterBtn.dataset.dir, chapterBtn.dataset.file, false, {
        actionSource: "navigation"
      });
    });
  }

  async function boot() {
    try {
      await loadLibrary();
      await loadAllWorkMaps();
      rebuildSearchIndex();

      renderWorksNav();
      wireSearch();
      wireWorksNavClicks();

      await buildReader();

      window.addEventListener("popstate", async () => {
        try {
          await buildReader();
        } catch (err) {
          showFatalError(err);
        }
      });
    } catch (err) {
      throw createAppError(
        err.code || ERROR_CODES.BOOT_FAILED,
        err.message || "Boot failed",
        err.details || {}
      );
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch(showFatalError);
  });
})();
