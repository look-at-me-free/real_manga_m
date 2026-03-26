(() => {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================= */

  const CONFIG = {
    libraryFile: "library.json",
    mapsBasePath: "search_maps",
    defaultWorksBase: "https://pub-cd01009a7c6c464aa0b093e33aa5ae51.r2.dev/works",
    fallbackWorkBlockBase: "https://pub-f78ac228b8f14431804e721a35484412.r2.dev/works",
    itemJsonName: "item.json",
    searchResultsLimit: 12,
    prefetchThreshold: 0.7,
    toastMs: 1800
  };

  /* =========================================================
     ERROR CODES
  ========================================================= */

  const ERROR = {
    LIBRARY_FETCH_FAILED: "LIBRARY_FETCH_FAILED",
    LIBRARY_INVALID: "LIBRARY_INVALID",
    NO_WORKS_FOUND: "NO_WORKS_FOUND",
    MAP_FETCH_FAILED: "MAP_FETCH_FAILED",
    MAP_INVALID: "MAP_INVALID",
    WORK_BLOCK_FETCH_FAILED: "WORK_BLOCK_FETCH_FAILED",
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

  /* =========================================================
     STATE
  ========================================================= */

  const STATE = {
    works: [],
    sourceMap: {},
    maps: new Map(),
    searchRows: [],
    currentWork: null,
    currentEntry: null,
    currentManifest: null,
    nextPrefetch: null,
    isMobileReader: document.body?.dataset?.readerMode === "mobile",
    searchWired: false,
    navWired: false,
    progressWired: false,
    dialWired: false,
    stickyWired: false,
    mobileOpenWorkSlug: ""
  };

  /* =========================================================
     DOM HELPERS
  ========================================================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function createEl(tag, className = "", text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  /* =========================================================
     UTILS
  ========================================================= */

  function normalizeKey(v) {
    return String(v ?? "").trim().toLowerCase();
  }

  function normalizeBaseUrl(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function titleCaseSlug(slug) {
    return String(slug ?? "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function escapeHtml(str) {
    return String(str ?? "")
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

  function appError(code, message, details = {}) {
    const err = new Error(message);
    err.code = code;
    err.details = details;
    return err;
  }

  function logError(err, context = "") {
    const code = err?.code || "UNEXPECTED_ERROR";
    const message = err?.message || "Unexpected error";
    console.error(`[${code}]${context ? ` ${context}` : ""}: ${message}`, err?.details || {}, err);
    return { code, message, details: err?.details || null };
  }

  function showFatalError(err) {
    const payload = logError(err, "Fatal");

    const title = $("#workTitle");
    const reader = $("#reader");
    const stat = $("#chapterSearchStat");

    if (title) title.textContent = `Failed to load (${payload.code})`;
    if (stat) stat.textContent = `Error: ${payload.code}`;

    if (reader) {
      reader.innerHTML = `
        <div class="note">
          <strong>Error code:</strong> ${escapeHtml(payload.code)}<br>
          <strong>Message:</strong> ${escapeHtml(payload.message)}<br>
          Check library.json, search_maps, item.json, base_url, and image paths.
        </div>
      `;
    }
  }

  /* =========================================================
     LIBRARY
  ========================================================= */

  async function loadLibrary() {
    let data;
    try {
      data = await fetchJson(CONFIG.libraryFile);
    } catch (e) {
      throw appError(ERROR.LIBRARY_FETCH_FAILED, "Failed to fetch library.json", { cause: e.message });
    }

    if (!data || typeof data !== "object" || !Array.isArray(data.works)) {
      throw appError(ERROR.LIBRARY_INVALID, "library.json is invalid");
    }

    if (!data.works.length) {
      throw appError(ERROR.NO_WORKS_FOUND, "library.json has no works");
    }

    STATE.works = data.works.filter(Boolean);
    STATE.sourceMap = data.sources && typeof data.sources === "object" ? data.sources : {};
  }

  function getSourceBaseByKey(sourceKey) {
    return sourceKey ? normalizeBaseUrl(STATE.sourceMap[sourceKey] || "") : "";
  }

  /* =========================================================
     WORK BLOCK FALLBACK
  ========================================================= */

  function workNeedsBlockFallback(work) {
    if (!work) return true;
    if (!Array.isArray(work.entries)) return true;
    if (work.entries.length === 0) return true;
    return false;
  }

  function getPrimaryWorkBlockUrl(work) {
    const sourceBase = getSourceBaseByKey(work.source) || CONFIG.defaultWorksBase;
    const slug = work.slug;
    return `${sourceBase}/${encodeURIComponent(slug)}/manifest_work_block_${encodeURIComponent(slug)}.json`;
  }

  function getFallbackWorkBlockUrl(work) {
    if (!CONFIG.fallbackWorkBlockBase) return null;
    const slug = work.slug;
    return `${CONFIG.fallbackWorkBlockBase}/${encodeURIComponent(slug)}/manifest_work_block_${encodeURIComponent(slug)}.json`;
  }

  function mergeWorkData(libraryWork, blockWork) {
    return {
      id: libraryWork?.id ?? blockWork?.id ?? null,
      slug: libraryWork?.slug || blockWork?.slug || "",
      display: libraryWork?.display || blockWork?.display || titleCaseSlug(blockWork?.slug || ""),
      top_pill: libraryWork?.top_pill ?? blockWork?.top_pill ?? true,
      source: libraryWork?.source || blockWork?.source || "",
      use_map: libraryWork?.use_map === true,
      map_file: libraryWork?.map_file || null,
      entries: Array.isArray(libraryWork?.entries) && libraryWork.entries.length
        ? libraryWork.entries
        : (Array.isArray(blockWork?.entries) ? blockWork.entries : [])
    };
  }

  async function loadWorkBlockWithFallback(work) {
    const primaryUrl = getPrimaryWorkBlockUrl(work);
    const fallbackUrl = getFallbackWorkBlockUrl(work);

    try {
      return await fetchJson(primaryUrl);
    } catch (primaryErr) {
      if (!fallbackUrl) {
        throw appError(ERROR.WORK_BLOCK_FETCH_FAILED, "Primary work block fetch failed", {
          slug: work.slug,
          primaryUrl,
          cause: primaryErr.message
        });
      }

      try {
        return await fetchJson(fallbackUrl);
      } catch (fallbackErr) {
        throw appError(ERROR.WORK_BLOCK_FETCH_FAILED, "Primary and fallback work block fetch failed", {
          slug: work.slug,
          primaryUrl,
          fallbackUrl,
          primaryCause: primaryErr.message,
          fallbackCause: fallbackErr.message
        });
      }
    }
  }

  async function hydrateWorksFromBlocksIfNeeded() {
    const resolved = [];

    for (const work of STATE.works) {
      if (!workNeedsBlockFallback(work)) {
        resolved.push(work);
        continue;
      }

      try {
        const blockWork = await loadWorkBlockWithFallback(work);
        resolved.push(mergeWorkData(work, blockWork));
      } catch (err) {
        logError(err, `Work block fallback failed for ${work.slug}`);
        resolved.push(work);
      }
    }

    STATE.works = resolved;
  }

  /* =========================================================
     MAPS
  ========================================================= */

  function shouldUseMap(work) {
    return work?.use_map === true;
  }

  function getMapFile(work) {
    if (!shouldUseMap(work)) return null;
    return `${CONFIG.mapsBasePath}/${work.map_file || `${work.slug}.json`}`;
  }

  function getMap(workOrSlug) {
    const slug = typeof workOrSlug === "string" ? workOrSlug : workOrSlug?.slug;
    return slug ? (STATE.maps.get(slug) || null) : null;
  }

  async function loadWorkMap(work) {
    if (!shouldUseMap(work)) return null;
    if (STATE.maps.has(work.slug)) return STATE.maps.get(work.slug);

    const path = getMapFile(work);

    try {
      const map = await fetchJson(path);
      if (!map || typeof map !== "object" || Array.isArray(map)) {
        throw appError(ERROR.MAP_INVALID, `Invalid map for ${work.slug}`, { path });
      }
      STATE.maps.set(work.slug, map);
      return map;
    } catch (e) {
      logError(
        appError(
          e.code || ERROR.MAP_FETCH_FAILED,
          `Failed to load map for ${work.slug}`,
          { work: work.slug, path, cause: e.message }
        ),
        "Map"
      );
      STATE.maps.set(work.slug, null);
      return null;
    }
  }

  async function loadAllMaps() {
    await Promise.all(STATE.works.filter(shouldUseMap).map(loadWorkMap));
  }

  function getChapterMeta(work, entry) {
    const map = getMap(work);
    return map?.chapter_locations?.[entry.slug] || null;
  }

  function getEntryDisplayLabel(work, entry) {
    const meta = getChapterMeta(work, entry);
    return meta?.display_label || entry.subtitle || titleCaseSlug(entry.slug);
  }

  /* =========================================================
     SEARCH INDEX
  ========================================================= */

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

  function buildSearchIndex() {
    try {
      const rows = [];

      for (const work of STATE.works) {
        const workLabel = work.display || titleCaseSlug(work.slug);
        const map = getMap(work);

        for (const entry of work.entries || []) {
          const chapterMeta = getChapterMeta(work, entry);

          rows.push(makeSearchRow({
            type: "entry",
            workSlug: work.slug,
            workLabel,
            entrySlug: entry.slug,
            entryLabel: getEntryDisplayLabel(work, entry),
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

        if (!map) continue;

        for (const [entrySlug, meta] of Object.entries(map.chapter_locations || {})) {
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

        for (const arc of (map.arcs || [])) {
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

        for (const semantic of (map.semantic_links || [])) {
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

        for (const anno of (map.image_annotations || [])) {
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

      STATE.searchRows = rows;
    } catch (e) {
      throw appError(ERROR.SEARCH_INDEX_BUILD_FAILED, "Failed to build search index", { cause: e.message });
    }
  }

  function renderSearchResults(items) {
    const results = $("#chapterSearchResults");
    const stat = $("#chapterSearchStat");
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
    const input = $("#chapterSearchInput");
    const stat = $("#chapterSearchStat");
    const results = $("#chapterSearchResults");
    if (!input || !stat || !results) return;
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

    const input = $("#chapterSearchInput");
    const results = $("#chapterSearchResults");
    const stat = $("#chapterSearchStat");
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

      const page = Number(btn.dataset.page || "");
      if (Number.isFinite(page) && page > 0) {
        setTimeout(() => scrollToPageIndex(page), 50);
      }
    });

    refresh();
  }

  /* =========================================================
     SELECTION / PATHS
  ========================================================= */

  function resolveSourceKey(work, entry) {
    return entry?.source || work?.source || "";
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
    const safeParts = path.split("/").filter(Boolean).map(part => encodeURIComponent(part));
    return `${getWorkBase(work, entry)}/${encodeURIComponent(work.slug)}/${safeParts.join("/")}/${CONFIG.itemJsonName}`;
  }

  function resolveSelection(dir, file) {
    const work = STATE.works.find(w => normalizeKey(w.slug) === normalizeKey(dir));
    if (!work) return null;

    const entry = (work.entries || []).find(e => normalizeKey(e.slug) === normalizeKey(file));
    if (!entry) return null;

    return { work, entry };
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
    if (replace) history.replaceState({}, "", url);
    else history.pushState({}, "", url);
  }

  function getEntryIndex(work, entry) {
    const entries = work?.entries || [];
    return entries.findIndex(e => normalizeKey(e.slug) === normalizeKey(entry?.slug));
  }

  function getEntryByOffset(work, entry, offset) {
    const entries = work?.entries || [];
    const currentIndex = getEntryIndex(work, entry);
    if (currentIndex < 0) return null;
    return entries[currentIndex + offset] || null;
  }

  /* =========================================================
     ADS FROM MANIFEST
  ========================================================= */

  function getSubids(manifest) {
    const subids = manifest?.subids || {};

    return {
      work: Number(subids.work) || 1101,
      top: Number(subids.top) || 5865232,
      left: Number(subids.left) || 5865238,
      right: Number(subids.right) || 5865240,
      between: Number(subids.between) || 5867482
    };
  }

  function makeIns(zoneId) {
    const ins = document.createElement("ins");
    ins.className = "eas6a97888e2";
    ins.dataset.zoneid = String(zoneId);
    ins.style.display = "block";
    return ins;
  }

  function serveAdsSafe() {
    try {
      window.AdProvider = window.AdProvider || [];
      window.AdProvider.push({ serve: {} });
    } catch (err) {
      console.warn("Ad serve failed", err);
    }
  }

  function buildTopBanner(manifest) {
    const shell = document.getElementById("topBannerSlot") || document.querySelector(".top-banner-inner");
    if (!shell) return;

    const subids = getSubids(manifest);
    shell.innerHTML = "";
    shell.appendChild(makeIns(subids.top));
  }

  function fillRail(slotId, zoneId) {
    const slot = document.getElementById(slotId);
    if (!slot) return;

    slot.innerHTML = "";
    slot.classList.add("slot");
    slot.appendChild(makeIns(zoneId));
  }

  function buildRails(manifest) {
    const subids = getSubids(manifest);

    const LEFT_RAIL_IDS = [
      "leftRailSlot1","leftRailSlot2","leftRailSlot3","leftRailSlot4","leftRailSlot5","leftRailSlot6",
      "leftRailSlot7","leftRailSlot8","leftRailSlot9","leftRailSlot10","leftRailSlot11","leftRailSlot12"
    ];

    const RIGHT_RAIL_IDS = [
      "rightRailSlot1","rightRailSlot2","rightRailSlot3","rightRailSlot4","rightRailSlot5","rightRailSlot6",
      "rightRailSlot7","rightRailSlot8","rightRailSlot9","rightRailSlot10","rightRailSlot11","rightRailSlot12"
    ];

    for (const id of LEFT_RAIL_IDS) fillRail(id, subids.left);
    for (const id of RIGHT_RAIL_IDS) fillRail(id, subids.right);
  }

  function betweenAd(manifest, groupNumber, betweenSlots) {
    const subids = getSubids(manifest);

    const wrap = createEl("section", "between-grid");
    const count = Math.max(1, Number(betweenSlots) || 3);

    for (let i = 0; i < count; i += 1) {
      const slot = createEl("div", "slot between-slot");
      slot.dataset.group = String(groupNumber);
      slot.dataset.index = String(i + 1);
      slot.appendChild(makeIns(subids.between));
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function endAds(manifest, finalBlock) {
    const subids = getSubids(manifest);

    const wrap = createEl("section", "end-grid");
    const count = Math.max(1, Number(finalBlock) || 6);

    for (let i = 0; i < count; i += 1) {
      const slot = createEl("div", "slot end-slot");
      slot.dataset.final = "1";
      slot.dataset.index = String(i + 1);
      slot.appendChild(makeIns(subids.between));
      wrap.appendChild(slot);
    }

    return wrap;
  }

  /* =========================================================
     WORKS NAV / MOBILE DIAL
  ========================================================= */

  function setMobileOpenWork(workSlug) {
    STATE.mobileOpenWorkSlug = normalizeKey(workSlug || "");

    $$(".mobile-work-item").forEach(item => {
      const isOpen = normalizeKey(item.dataset.workSlug) === STATE.mobileOpenWorkSlug;
      item.classList.toggle("open", isOpen);
      item.classList.toggle("active", isOpen);
    });
  }

  function syncDialThumb() {
    if (!STATE.isMobileReader) return;

    const scrollEl = $("#worksNav");
    const track = $("#dialTrack");
    const thumb = $("#dialThumb");
    if (!scrollEl || !track || !thumb) return;

    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const thumbH = thumb.offsetHeight || 32;
    const maxTop = Math.max(0, track.clientHeight - thumbH);
    const ratio = maxScroll > 0 ? scrollEl.scrollTop / maxScroll : 0;
    thumb.style.top = `${maxTop * ratio}px`;
  }

  function renderWorksNav() {
    const nav = $("#worksNav");
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
          const current =
            isActiveWork && normalizeKey(entry.slug) === normalizeKey(STATE.currentEntry?.slug)
              ? " current"
              : "";

          html += `
            <button class="mobile-chapter-link${current}" type="button" data-dir="${escapeHtml(work.slug)}" data-file="${escapeHtml(entry.slug)}">
              ${escapeHtml(getEntryDisplayLabel(work, entry))}
            </button>
          `;
        }

        html += `</div></section>`;
      }

      nav.innerHTML = html;
      syncDialThumb();
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

  function wireNavClicks() {
    if (STATE.navWired) return;
    STATE.navWired = true;

    document.addEventListener("click", async (e) => {
      const toggle = e.target.closest("[data-work-toggle]");
      if (toggle && STATE.isMobileReader) {
        setMobileOpenWork(toggle.dataset.workToggle);
        return;
      }

      const navBtn = e.target.closest(".topworks-link, .mobile-chapter-link, .traversal-pill");
      if (!navBtn) return;
      const dir = navBtn.dataset.dir;
      const file = navBtn.dataset.file;
      if (!dir || !file) return;

      await switchEntry(dir, file, false, { actionSource: "navigation" });
    });
  }

  function wireMobileDial() {
    if (!STATE.isMobileReader || STATE.dialWired) return;
    STATE.dialWired = true;

    const scrollEl = $("#worksNav");
    const track = $("#dialTrack");
    const thumb = $("#dialThumb");
    if (!scrollEl || !track || !thumb) return;

    let dragging = false;

    const moveThumb = (clientY) => {
      const rect = track.getBoundingClientRect();
      const thumbH = thumb.offsetHeight || 44;
      const maxTop = Math.max(0, rect.height - thumbH);

      let top = clientY - rect.top - thumbH / 2;
      top = Math.max(0, Math.min(maxTop, top));

      const ratio = maxTop > 0 ? top / maxTop : 0;
      const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);

      scrollEl.scrollTop = maxScroll * ratio;
      thumb.style.top = `${top}px`;
    };

    track.addEventListener("pointerdown", (e) => {
      dragging = true;
      track.setPointerCapture?.(e.pointerId);
      moveThumb(e.clientY);
    });

    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      moveThumb(e.clientY);
    });

    track.addEventListener("pointerup", (e) => {
      dragging = false;
      track.releasePointerCapture?.(e.pointerId);
    });

    track.addEventListener("pointercancel", () => {
      dragging = false;
    });

    scrollEl.addEventListener("scroll", syncDialThumb, { passive: true });
    window.addEventListener("resize", syncDialThumb);
    syncDialThumb();
  }

  /* =========================================================
     TOAST / PROGRESS / SCROLL
  ========================================================= */

  function showRetentionToast(message) {
    if (!message) return;

    let toast = $("#retentionToast");
    if (!toast) {
      toast = createEl("div", "retention-toast");
      toast.id = "retentionToast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(showRetentionToast._timer);
    showRetentionToast._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, CONFIG.toastMs);
  }

  function updatePageProgressBar(ratio) {
    const bar = $("#pageProgressBar");
    if (!bar) return;
    bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  function updateChapterProgress(ratio) {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    const fill = $("#chapterProgressFill");
    const percent = $("#chapterProgressPercent");
    const label = $("#chapterProgressLabel");

    if (fill) fill.style.width = `${pct}%`;
    if (percent) percent.textContent = `${pct}%`;
    if (label) label.textContent = getEntryDisplayLabel(STATE.currentWork, STATE.currentEntry) || "Chapter Progress";
  }

  function getScrollRatio() {
    const scrollEl = document.scrollingElement || document.documentElement;
    const maxScroll = Math.max(1, scrollEl.scrollHeight - window.innerHeight);
    const top = Math.max(0, scrollEl.scrollTop);
    return maxScroll > 0 ? Math.min(1, top / maxScroll) : 0;
  }

  function maybePrefetchNext() {
    if (STATE.nextPrefetch) return;

    const next = getEntryByOffset(STATE.currentWork, STATE.currentEntry, 1);
    if (!next) return;

    try {
      const url = getItemJsonUrl(STATE.currentWork, next);
      STATE.nextPrefetch = fetch(url, { cache: "force-cache" }).catch(() => null);
    } catch {
      // ignore
    }
  }

  function updateReaderProgress() {
    const ratio = getScrollRatio();
    updatePageProgressBar(ratio);
    updateChapterProgress(ratio);

    if (ratio >= CONFIG.prefetchThreshold) {
      maybePrefetchNext();
    }
  }

  function wireProgressWatch() {
    if (STATE.progressWired) return;
    STATE.progressWired = true;

    window.addEventListener("scroll", updateReaderProgress, { passive: true });
    window.addEventListener("resize", updateReaderProgress);
  }

  function scrollToPageIndex(pageNumber) {
    const wraps = $$(".image-wrap");
    if (!wraps.length) return;
    const target = wraps[Math.max(0, Math.min(wraps.length - 1, pageNumber - 1))];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToReaderTop() {
    const reader = $("#reader");
    if (!reader) return;
    reader.scrollIntoView({ behavior: "auto", block: "start" });
  }

  function scrollToReaderBottom() {
    const reader = $("#reader");
    if (!reader) return;
    window.scrollTo({
      top: reader.offsetTop + reader.offsetHeight,
      behavior: "smooth"
    });
  }

  function scrollToSearchBar() {
    const anchor = $("#searchBarAnchor");
    if (!anchor) return;
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function wireStickyButtons() {
    if (STATE.stickyWired) return;
    STATE.stickyWired = true;

    $("#scrollToSearchBtn")?.addEventListener("click", () => {
      scrollToSearchBar();
    });

    $("#scrollToBottomTraversalBtn")?.addEventListener("click", () => {
      scrollToReaderBottom();
    });
  }

  /* =========================================================
     MANIFEST / READER BUILD
  ========================================================= */

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

  function validateManifest(manifest, itemUrl) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw appError(ERROR.MANIFEST_INVALID, "item.json is not a valid object", { itemUrl });
    }

    const baseUrl = normalizeBaseUrl(manifest.base_url);
    if (!baseUrl) {
      throw appError(ERROR.MANIFEST_NO_BASE_URL, "item.json missing base_url", { itemUrl });
    }

    const images = buildImageList(manifest);
    if (!images.length) {
      throw appError(ERROR.MANIFEST_NO_IMAGES, "No images found in item.json", { itemUrl });
    }

    return { manifest, baseUrl, images };
  }

  function buildChapterMeta(manifest, imageCount) {
    const meta = createEl("section", "chapter-meta");
    const row = createEl("div", "meta-row");

    const mapped = getChapterMeta(STATE.currentWork, STATE.currentEntry);
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

    const note = createEl(
      "div",
      "chapter-note",
      STATE.isMobileReader
        ? "Use the search and chapter controls whenever you want to jump fast."
        : "Keep reading. Use the bottom controls to roll straight into the next chapter without losing momentum."
    );

    row.appendChild(leftTag);
    row.appendChild(rightTag);
    meta.appendChild(row);
    meta.appendChild(note);

    return meta;
  }

  function buildTraversal(which = "bottom") {
    const shell = createEl("section", "chapter-traversal");

    const prev = getEntryByOffset(STATE.currentWork, STATE.currentEntry, -1);
    const next = getEntryByOffset(STATE.currentWork, STATE.currentEntry, 1);

    const heading = createEl(
      "p",
      "traversal-heading",
      which === "top" ? "Jump around this work" : "Keep moving"
    );

    const row = createEl("div", "traversal-row");

    if (prev) {
      const btn = createEl("button", "traversal-pill", `← ${getEntryDisplayLabel(STATE.currentWork, prev)}`);
      btn.type = "button";
      btn.dataset.dir = STATE.currentWork.slug;
      btn.dataset.file = prev.slug;
      row.appendChild(btn);
    }

    const current = createEl("button", "traversal-pill current", getEntryDisplayLabel(STATE.currentWork, STATE.currentEntry));
    current.type = "button";
    current.dataset.dir = STATE.currentWork.slug;
    current.dataset.file = STATE.currentEntry.slug;
    row.appendChild(current);

    if (next) {
      const btn = createEl("button", "traversal-pill", `${getEntryDisplayLabel(STATE.currentWork, next)} →`);
      btn.type = "button";
      btn.dataset.dir = STATE.currentWork.slug;
      btn.dataset.file = next.slug;
      row.appendChild(btn);
    }

    shell.appendChild(heading);
    shell.appendChild(row);
    return shell;
  }

  function buildImageAnnotationBadge(pageNumber) {
    const map = getMap(STATE.currentWork);
    if (!map) return null;

    const hits = (map.image_annotations || []).filter(a =>
      normalizeKey(a.entry_slug) === normalizeKey(STATE.currentEntry?.slug) &&
      Number(a.page) === Number(pageNumber)
    );

    if (!hits.length) return null;
    return createEl("div", "page-annotation-badge", `${hits.length} note${hits.length === 1 ? "" : "s"}`);
  }

  async function buildReader() {
    const reader = $("#reader");
    if (!reader) return;

    let selection = resolveSelectionFromQuery();
    if (!selection) {
      selection = resolveDefaultSelection();
    }

    if (!selection) {
      throw appError(ERROR.SELECTION_NOT_FOUND, "Could not resolve current work/entry");
    }

    STATE.currentWork = selection.work;
    STATE.currentEntry = selection.entry;
    STATE.nextPrefetch = null;

    const itemUrl = getItemJsonUrl(selection.work, selection.entry);

    let manifestRaw;
    try {
      manifestRaw = await fetchJson(itemUrl);
    } catch (e) {
      throw appError(ERROR.MANIFEST_FETCH_FAILED, "Failed to fetch item.json", {
        itemUrl,
        work: selection.work.slug,
        entry: selection.entry.slug,
        cause: e.message
      });
    }

    const { manifest, baseUrl, images } = validateManifest(manifestRaw, itemUrl);
    STATE.currentManifest = manifest;

    const workTitle = $("#workTitle");
    if (workTitle) {
      workTitle.textContent = `${selection.work.display || titleCaseSlug(selection.work.slug)} · ${getEntryDisplayLabel(selection.work, selection.entry)}`;
    }

    renderWorksNav();
    syncSearchSeed();

    buildTopBanner(manifest);
    buildRails(manifest);

    reader.innerHTML = "";
    reader.appendChild(buildTraversal("top"));
    reader.appendChild(buildChapterMeta(manifest, images.length));

    const betweenEvery = Number(manifest?.ads?.between_every) || 0;
    const betweenSlots = Number(manifest?.ads?.between_slots) || 3;
    const finalBlock = Number(manifest?.ads?.final_block) || 0;

    let groupNumber = 0;

    for (let i = 0; i < images.length; i += 1) {
      const pageNumber = i + 1;
      const wrap = createEl("article", "image-wrap");
      wrap.dataset.page = String(pageNumber);

      const img = new Image();
      img.loading = i < 2 ? "eager" : "lazy";
      img.decoding = "async";
      img.src = `${baseUrl}/${images[i]}`;
      img.alt = `${selection.work.display || selection.work.slug} · ${getEntryDisplayLabel(selection.work, selection.entry)} · Page ${pageNumber}`;
      wrap.appendChild(img);

      const badge = buildImageAnnotationBadge(pageNumber);
      if (badge) wrap.appendChild(badge);

      reader.appendChild(wrap);

      if (betweenEvery > 0 && pageNumber % betweenEvery === 0 && pageNumber < images.length) {
        groupNumber += 1;
        reader.appendChild(betweenAd(manifest, groupNumber, betweenSlots));
      }
    }

    if (finalBlock > 0) {
      reader.appendChild(endAds(manifest, finalBlock));
    }

    reader.appendChild(buildTraversal("bottom"));

    updatePageProgressBar(0);
    updateChapterProgress(0);

    setTimeout(() => {
      serveAdsSafe();
    }, 100);
  }

  /* =========================================================
     SWITCH ENTRY
  ========================================================= */

  async function switchEntry(dir, file, replace = false, options = {}) {
    try {
      const selection = resolveSelection(dir, file);
      if (!selection) {
        throw appError(ERROR.SELECTION_NOT_FOUND, `Could not resolve selection for ${dir}/${file}`, { dir, file });
      }

      setQueryState(dir, file, replace);
      await buildReader();
      scrollToReaderTop();

      showRetentionToast(`Now reading: ${getEntryDisplayLabel(selection.work, selection.entry)}`);
    } catch (e) {
      throw appError(ERROR.SWITCH_ENTRY_FAILED, "Failed to switch entry", {
        dir,
        file,
        source: options.actionSource || "unknown",
        cause: e.message
      });
    }
  }

  /* =========================================================
     BOOT
  ========================================================= */

  async function boot() {
    try {
      await loadLibrary();
      await hydrateWorksFromBlocksIfNeeded();
      await loadAllMaps();
      buildSearchIndex();

      wireSearch();
      wireNavClicks();
      wireProgressWatch();
      wireMobileDial();
      wireStickyButtons();

      await buildReader();

      window.addEventListener("popstate", async () => {
        try {
          await buildReader();
          scrollToReaderTop();
        } catch (e) {
          showFatalError(e);
        }
      });
    } catch (e) {
      throw appError(e.code || ERROR.BOOT_FAILED, e.message || "Boot failed", e.details || {});
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch(showFatalError);
  });
})();
