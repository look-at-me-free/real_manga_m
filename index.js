(() => {
  "use strict";

  const LIBRARY_FILE = "library.json";
  const DEFAULT_WORKS_BASE = "https://pub-cd01009a7c6c464aa0b093e33aa5ae51.r2.dev/works";
  const ITEM_JSON_NAME = "item.json";
  const BOTTOM_AD_COUNT = 6;

  // More aggressive than the original, but still not absurd.
  const RAIL_REFRESH_MS = 45000;
  const BANNER_REFRESH_MS = 60000;
  const BETWEEN_REFRESH_MS = 50000;

  const READ_PROGRESS_PREFETCH = 0.7;
  const BOTTOM_GLOW_PROGRESS = 0.95;
  const SEARCH_RESULTS_LIMIT = 12;
  const IS_MOBILE_READER = document.body?.dataset?.readerMode === "mobile";

  // Guardrails for ad serving / refreshing.
  const MIN_GLOBAL_SERVE_GAP_MS = 1200;
  const MIN_SLOT_REFRESH_GAP_MS = 30000;
  const VIEWPORT_THRESHOLD = 0.2;

  const ZONES = {
    topBanner: 5865232,
    leftRail: 5865238,
    rightRail: 5865240,
    betweenMulti: 5867482
  };

  const LEFT_RAIL_IDS = [
    "leftRailSlot1","leftRailSlot2","leftRailSlot3","leftRailSlot4","leftRailSlot5","leftRailSlot6",
    "leftRailSlot7","leftRailSlot8","leftRailSlot9","leftRailSlot10","leftRailSlot11","leftRailSlot12"
  ];

  const RIGHT_RAIL_IDS = [
    "rightRailSlot1","rightRailSlot2","rightRailSlot3","rightRailSlot4","rightRailSlot5","rightRailSlot6",
    "rightRailSlot7","rightRailSlot8","rightRailSlot9","rightRailSlot10","rightRailSlot11","rightRailSlot12"
  ];

  let ARCHIVE_WORKS = [];
  let SOURCE_MAP = {};
  let CURRENT_WORK = null;
  let CURRENT_ENTRY = null;
  let CURRENT_ITEM = null;

  let topFlyoutsWired = false;
  let stickyControlsWired = false;
  let searchWired = false;
  let railRefreshTimer = null;
  let bannerRefreshTimer = null;
  let betweenRefreshTimer = null;
  let nextPrefetch = null;
  let progressWatchWired = false;
  let bottomGlowTriggered = false;
  let mobileWorksWired = false;
  let mobileOpenWorkSlug = "";
  let dialWired = false;

  let adServeScheduled = false;
  let lastServeAt = 0;
  let adVisibilityObserver = null;
  let adActionBurstCooldownUntil = 0;

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeKey(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function titleCaseSlug(slug) {
    return String(slug ?? "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function normalizeBaseUrl(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function now() {
    return Date.now();
  }

  function isElementInViewport(el, threshold = VIEWPORT_THRESHOLD) {
    if (!el || !el.isConnected) return false;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) return false;

    const visibleX = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    const visibleY = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const visibleArea = visibleX * visibleY;
    const totalArea = rect.width * rect.height;
    if (totalArea <= 0) return false;

    return (visibleArea / totalArea) >= threshold;
  }

  function canRefreshSlot(el) {
    if (!el) return false;
    const last = Number(el.dataset.lastRefreshAt || 0);
    return (now() - last) >= MIN_SLOT_REFRESH_GAP_MS;
  }

  function stampSlotRefresh(el) {
    if (!el) return;
    el.dataset.lastRefreshAt = String(now());
  }

  function markSlotSeen(el) {
    if (!el) return;
    el.dataset.seen = "1";
  }

  function wasSlotSeen(el) {
    return !!el && el.dataset.seen === "1";
  }

  function resolveSourceKey(work, entry) {
    return entry?.source || work?.source || "";
  }

  function getSourceBaseByKey(sourceKey) {
    if (!sourceKey) return "";
    return normalizeBaseUrl(SOURCE_MAP[sourceKey] || "");
  }

  function getWorkBase(work, entry) {
    return normalizeBaseUrl(
      entry?.base_url ||
      getSourceBaseByKey(resolveSourceKey(work, entry)) ||
      work?.base_url ||
      DEFAULT_WORKS_BASE
    );
  }

  function getItemJsonUrl(work, entry) {
    if (entry?.item_url) {
      return entry.item_url;
    }

    const entryPathOrSlug = entry?.path || entry?.slug || "";
    const safeParts = String(entryPathOrSlug)
      .split("/")
      .filter(Boolean)
      .map(part => encodeURIComponent(part));

    return `${getWorkBase(work, entry)}/${encodeURIComponent(work.slug)}/${safeParts.join("/")}/${ITEM_JSON_NAME}`;
  }

  function scrollToReaderTop() {
    const target =
      document.getElementById("readerTopAnchor") ||
      document.getElementById("reader") ||
      document.getElementById("searchBarAnchor");

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function scrollToSearchBar() {
    const target =
      document.getElementById("searchBarAnchor") ||
      document.querySelector(".hero");

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function setMobileOpenWork(workSlug) {
    mobileOpenWorkSlug = normalizeKey(workSlug || "");

    const items = $$(".mobile-work-item");
    items.forEach(item => {
      const isOpen = normalizeKey(item.dataset.workSlug) === mobileOpenWorkSlug;
      item.classList.toggle("open", isOpen);
      item.classList.toggle("active", isOpen);
    });
  }

  function syncDialThumb() {
    if (!IS_MOBILE_READER) return;

    const scrollEl = document.getElementById("worksNav");
    const track = document.getElementById("dialTrack");
    const thumb = document.getElementById("dialThumb");
    if (!scrollEl || !track || !thumb) return;

    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const trackH = track.clientHeight;
    const thumbH = thumb.offsetHeight;
    const maxTop = Math.max(0, trackH - thumbH);

    const ratio = maxScroll > 0 ? scrollEl.scrollTop / maxScroll : 0;
    thumb.style.top = `${maxTop * ratio}px`;
  }

  function wireMobileDial() {
    if (!IS_MOBILE_READER || dialWired) return;
    dialWired = true;

    const scrollEl = document.getElementById("worksNav");
    const track = document.getElementById("dialTrack");
    const thumb = document.getElementById("dialThumb");
    if (!scrollEl || !track || !thumb) return;

    let dragging = false;

    const moveThumb = (clientY) => {
      const rect = track.getBoundingClientRect();
      const thumbH = thumb.offsetHeight;
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

  function rawServeAds() {
    (window.AdProvider = window.AdProvider || []).push({ serve: {} });
    lastServeAt = now();
    adServeScheduled = false;
  }

  function serveAds(force = false) {
    const elapsed = now() - lastServeAt;

    if (force || elapsed >= MIN_GLOBAL_SERVE_GAP_MS) {
      rawServeAds();
      return;
    }

    if (adServeScheduled) return;
    adServeScheduled = true;

    window.setTimeout(() => {
      rawServeAds();
    }, Math.max(0, MIN_GLOBAL_SERVE_GAP_MS - elapsed));
  }

  function burstServeAds() {
    if (document.hidden) return;

    // Prevent action spam from triggering too many bursts back-to-back.
    if (now() < adActionBurstCooldownUntil) return;
    adActionBurstCooldownUntil = now() + 3500;

    serveAds(true);
    window.setTimeout(() => serveAds(true), 700);
  }

  function makeIns(zoneId, sub = 1, sub2 = 1, sub3 = 1) {
    const ins = document.createElement("ins");
    ins.className = "eas6a97888e38";
    ins.setAttribute("data-zoneid", String(zoneId));
    ins.setAttribute("data-sub", String(sub));
    ins.setAttribute("data-sub2", String(sub2));
    ins.setAttribute("data-sub3", String(sub3));
    return ins;
  }

  function refillSlot(el, zoneId, sub = 1, sub2 = 1, sub3 = 1) {
    if (!el) return;
    el.innerHTML = "";
    el.appendChild(makeIns(zoneId, sub, sub2, sub3));
    stampSlotRefresh(el);
  }

  function fillSlot(el, zoneId, sub = 1, sub2 = 1, sub3 = 1) {
    if (!el) return;
    refillSlot(el, zoneId, sub, sub2, sub3);
    serveAds();
  }

  function refillSlotIfVisible(el, zoneId, sub = 1, sub2 = 1, sub3 = 1) {
    if (!el || document.hidden) return false;
    if (!isElementInViewport(el)) return false;
    if (!canRefreshSlot(el)) return false;

    refillSlot(el, zoneId, sub, sub2, sub3);
    markSlotSeen(el);
    return true;
  }

  function setupAdVisibilityObserver() {
    if (adVisibilityObserver) {
      adVisibilityObserver.disconnect();
      adVisibilityObserver = null;
    }

    adVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target) {
          markSlotSeen(entry.target);
        }
      }
    }, {
      root: null,
      threshold: [0.2, 0.5]
    });

    $$(".slot, .top-banner-inner").forEach(el => {
      adVisibilityObserver.observe(el);
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url} (${res.status})`);
    }
    return res.json();
  }

  async function loadLibrary() {
    const data = await fetchJson(LIBRARY_FILE);
    ARCHIVE_WORKS = Array.isArray(data.works) ? data.works : [];
    SOURCE_MAP = data && typeof data.sources === "object" && data.sources ? data.sources : {};
  }

  function getQueryState() {
    const url = new URL(window.location.href);
    return {
      dir: url.searchParams.get("dir") || "",
      file: url.searchParams.get("file") || ""
    };
  }

  function setQueryState(dir, file, replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.set("dir", dir);
    url.searchParams.set("file", file);

    if (replace) {
      history.replaceState({ dir, file }, "", url);
    } else {
      history.pushState({ dir, file }, "", url);
    }
  }

  function getFirstEntry() {
    for (const work of ARCHIVE_WORKS) {
      const first = Array.isArray(work.entries) ? work.entries[0] : null;
      if (work?.slug && first?.slug) {
        return { work, entry: first };
      }
    }
    return { work: null, entry: null };
  }

  function resolveSelection(dir, file) {
    const d = normalizeKey(dir);
    const f = normalizeKey(file);

    for (const work of ARCHIVE_WORKS) {
      if (normalizeKey(work.slug) !== d) continue;
      for (const entry of work.entries || []) {
        if (normalizeKey(entry.slug) === f) {
          return { work, entry };
        }
      }
    }

    return null;
  }

  function buildImageList(manifest) {
    if (Array.isArray(manifest.images) && manifest.images.length) {
      return manifest.images;
    }

    if (Number.isFinite(manifest.pages) && manifest.pages > 0) {
      const ext = manifest.extension || "jpg";
      const padding = Number.isFinite(manifest.padding) ? manifest.padding : 2;

      return Array.from({ length: manifest.pages }, (_, i) => {
        const n = String(i + 1).padStart(padding, "0");
        return `${n}.${ext}`;
      });
    }

    return [];
  }

  function getSubids(manifest) {
    const fallbackWork = Number(manifest.parent_work_id) || 1;

    return {
      work: manifest.subids?.work ?? fallbackWork,
      top: manifest.subids?.top ?? fallbackWork + 10,
      left: manifest.subids?.left ?? fallbackWork + 20,
      right: manifest.subids?.right ?? fallbackWork + 30,
      between: manifest.subids?.between ?? fallbackWork + 40
    };
  }

  function imageBlock(src, alt) {
    const wrap = document.createElement("div");
    wrap.className = "image-wrap";

    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.loading = "lazy";
    img.decoding = "async";

    wrap.appendChild(img);
    return wrap;
  }

  function betweenAd(manifest, groupNumber, slotCount) {
    const subids = getSubids(manifest);

    const wrap = document.createElement("div");
    wrap.className = "between-grid";

    for (let i = 1; i <= slotCount; i++) {
      const slot = document.createElement("div");
      slot.className = "slot between-slot";
      slot.dataset.zoneType = "between";
      slot.dataset.zoneId = String(ZONES.betweenMulti);
      slot.dataset.sub = String(subids.between);
      slot.dataset.sub2 = String(subids.work);
      slot.dataset.sub3 = String(Number(`${groupNumber}${i}`));

      slot.appendChild(
        makeIns(ZONES.betweenMulti, subids.between, subids.work, Number(`${groupNumber}${i}`))
      );
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function endAds(manifest, count) {
    const subids = getSubids(manifest);

    const wrap = document.createElement("div");
    wrap.className = "end-grid";

    for (let i = 1; i <= count; i++) {
      const slot = document.createElement("div");
      slot.className = "slot between-slot";
      slot.dataset.zoneType = "between";
      slot.dataset.zoneId = String(ZONES.betweenMulti);
      slot.dataset.sub = String(subids.between);
      slot.dataset.sub2 = String(subids.work);
      slot.dataset.sub3 = String(9000 + i);

      slot.appendChild(makeIns(ZONES.betweenMulti, subids.between, subids.work, 9000 + i));
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function fillRailStacks(subids) {
    LEFT_RAIL_IDS.forEach((id, index) => {
      fillSlot(document.getElementById(id), ZONES.leftRail, subids.left, subids.work, index + 1);
    });

    RIGHT_RAIL_IDS.forEach((id, index) => {
      fillSlot(document.getElementById(id), ZONES.rightRail, subids.right, subids.work, index + 1);
    });
  }

  function flattenEntries() {
    const rows = [];

    for (const work of ARCHIVE_WORKS) {
      for (const entry of work.entries || []) {
        rows.push({
          workSlug: work.slug,
          workLabel: work.display || titleCaseSlug(work.slug),
          entrySlug: entry.slug,
          entryLabel: entry.subtitle || titleCaseSlug(entry.slug),
          searchKey: normalizeKey(
            `${work.display || work.slug} ${entry.subtitle || entry.slug} ${entry.slug}`
          )
        });
      }
    }

    return rows;
  }

  function renderSearchResults(items) {
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    if (!results || !stat) return;

    if (!items.length) {
      results.innerHTML = "";
      stat.textContent = IS_MOBILE_READER ? "Type to search" : "No matches yet";
      return;
    }

    stat.textContent = `${items.length} quick jump${items.length === 1 ? "" : "s"}`;
    results.innerHTML = items.map(item => `
      <button class="search-result-pill" type="button" data-dir="${escapeHtml(item.workSlug)}" data-file="${escapeHtml(item.entrySlug)}">
        ${escapeHtml(item.workLabel)} · ${escapeHtml(item.entryLabel)}
      </button>
    `).join("");
  }

  function wireSearch() {
    if (searchWired) return;
    searchWired = true;

    const input = document.getElementById("chapterSearchInput");
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    if (!input || !results || !stat) return;

    const all = flattenEntries();

    const refresh = () => {
      const query = normalizeKey(input.value);

      if (!query) {
        if (IS_MOBILE_READER) {
          results.innerHTML = "";
          stat.textContent = "Type to search";
          return;
        }

        const seeded = all
          .filter(item => item.workSlug === CURRENT_WORK?.slug)
          .slice(0, SEARCH_RESULTS_LIMIT);

        renderSearchResults(seeded);
        stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
        return;
      }

      const matched = all
        .filter(item => item.searchKey.includes(query))
        .slice(0, SEARCH_RESULTS_LIMIT);

      renderSearchResults(matched);
      stat.textContent = matched.length ? `${matched.length} result${matched.length === 1 ? "" : "s"}` : "No matches";
    };

    input.addEventListener("input", refresh);

    input.addEventListener("focus", () => {
      burstServeAds();
    });

    results.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-dir][data-file]");
      if (!btn) return;

      input.value = "";

      if (IS_MOBILE_READER) {
        results.innerHTML = "";
        stat.textContent = "Type to search";
        setMobileOpenWork(btn.dataset.dir);
      }

      burstServeAds();
      await switchEntry(btn.dataset.dir, btn.dataset.file, false, { actionSource: "search" });

      if (IS_MOBILE_READER) {
        scrollToReaderTop();
      }
    });

    refresh();
  }

  function syncSearchSeed() {
    const input = document.getElementById("chapterSearchInput");
    const stat = document.getElementById("chapterSearchStat");
    const results = document.getElementById("chapterSearchResults");
    if (!input || !stat || !results) return;
    if (input.value.trim()) return;

    if (IS_MOBILE_READER) {
      results.innerHTML = "";
      stat.textContent = "Type to search";
      return;
    }

    const seeded = flattenEntries()
      .filter(item => item.workSlug === CURRENT_WORK?.slug)
      .slice(0, SEARCH_RESULTS_LIMIT);

    renderSearchResults(seeded);
    stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
  }

  function renderWorksNav() {
    const nav = document.getElementById("worksNav");
    if (!nav) return;

    if (IS_MOBILE_READER) {
      let html = "";

      for (const work of ARCHIVE_WORKS.filter(w => w.top_pill !== false)) {
        const isActiveWork = normalizeKey(work.slug) === normalizeKey(CURRENT_WORK?.slug);
        const isOpen = normalizeKey(work.slug) === normalizeKey(mobileOpenWorkSlug || CURRENT_WORK?.slug);
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
            isActiveWork && normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug)
              ? " current"
              : "";

          html += `
            <button
              class="mobile-chapter-link${active}"
              type="button"
              data-dir="${escapeHtml(work.slug)}"
              data-file="${escapeHtml(entry.slug)}"
            >
              ${escapeHtml(entry.subtitle || titleCaseSlug(entry.slug))}
            </button>
          `;
        }

        html += `
            </div>
          </section>
        `;
      }

      nav.innerHTML = html;
      syncDialThumb();
      return;
    }

    let html = "";

    for (const work of ARCHIVE_WORKS.filter(w => w.top_pill !== false)) {
      const isActive = normalizeKey(work.slug) === normalizeKey(CURRENT_WORK?.slug);
      const entries = Array.isArray(work.entries) ? work.entries : [];

      html += `
        <div class="topworks-item${isActive ? " active" : ""}">
          <button class="topworks-trigger" type="button">
            <span>${escapeHtml(work.display || titleCaseSlug(work.slug))}</span>
            <span class="topworks-caret"></span>
          </button>
          <div class="topworks-flyout">
            <div class="topworks-links">
      `;

      for (const entry of entries) {
        const label = `${work.display || titleCaseSlug(work.slug)} · ${entry.subtitle || titleCaseSlug(entry.slug)}`;
        const active = isActive && normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug) ? " active" : "";

        html += `
          <a href="?dir=${encodeURIComponent(work.slug)}&file=${encodeURIComponent(entry.slug)}" class="topworks-link${active}" data-dir="${escapeHtml(work.slug)}" data-file="${escapeHtml(entry.slug)}">${escapeHtml(label)}</a>
        `;
      }

      html += `
            </div>
          </div>
        </div>
      `;
    }

    nav.innerHTML = html;

    nav.onclick = async (e) => {
      const a = e.target.closest("a[data-dir][data-file]");
      if (!a) return;
      e.preventDefault();
      burstServeAds();
      await switchEntry(a.dataset.dir, a.dataset.file, false, { actionSource: "top-nav" });
    };
  }

  function wireTopFlyouts() {
    if (topFlyoutsWired) return;
    topFlyoutsWired = true;

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest(".topworks-trigger");
      if (trigger) {
        const item = trigger.closest(".topworks-item");
        if (!item) return;

        e.preventDefault();
        const wasOpen = item.classList.contains("open");
        $$(".topworks-item.open").forEach(x => x.classList.remove("open"));
        if (!wasOpen) {
          item.classList.add("open");
          burstServeAds();
        }
        return;
      }

      if (!e.target.closest(".topworks-item")) {
        $$(".topworks-item.open").forEach(x => x.classList.remove("open"));
      }
    });
  }

  function wireMobileWorksNav() {
    if (!IS_MOBILE_READER || mobileWorksWired) return;
    mobileWorksWired = true;

    const nav = document.getElementById("worksNav");
    if (!nav) return;

    nav.addEventListener("click", async (e) => {
      const toggle = e.target.closest("[data-work-toggle]");
      if (toggle) {
        const slug = toggle.dataset.workToggle;
        const normalized = normalizeKey(slug);
        const isAlreadyOpen = normalized === normalizeKey(mobileOpenWorkSlug);

        setMobileOpenWork(isAlreadyOpen ? "" : slug);
        syncDialThumb();
        burstServeAds();
        return;
      }

      const chapterBtn = e.target.closest("button[data-dir][data-file]");
      if (!chapterBtn) return;

      const dir = chapterBtn.dataset.dir;
      const file = chapterBtn.dataset.file;

      setMobileOpenWork(dir);
      burstServeAds();
      await switchEntry(dir, file, false, { actionSource: "mobile-nav" });
      scrollToReaderTop();
    });
  }

  function getEntryContext() {
    const entries = Array.isArray(CURRENT_WORK?.entries) ? CURRENT_WORK.entries : [];
    const currentIndex = entries.findIndex(entry => normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug));

    return {
      entries,
      currentIndex,
      prev: currentIndex > 0 ? entries[currentIndex - 1] : null,
      next: currentIndex >= 0 && currentIndex < entries.length - 1 ? entries[currentIndex + 1] : null
    };
  }

  function makeTraversalPill(label, onClick, extraClass = "", disabled = false) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `traversal-pill${extraClass ? ` ${extraClass}` : ""}`;
    btn.textContent = label;
    btn.disabled = !!disabled;

    if (!disabled && typeof onClick === "function") {
      btn.addEventListener("click", onClick);
    }

    return btn;
  }

  function buildTraversal(position = "top") {
    const shell = document.createElement("section");
    shell.className = `traversal-shell ${position}`;
    if (position === "bottom") shell.id = "bottomTraversal";

    const kicker = document.createElement("p");
    kicker.className = "traversal-kicker";
    kicker.textContent = IS_MOBILE_READER
      ? "Quick Chapter Jump"
      : (position === "top" ? "Chapter Navigation" : "Keep The Scroll Alive");
    shell.appendChild(kicker);

    if (!IS_MOBILE_READER && position === "bottom") {
      const prompt = document.createElement("div");
      prompt.className = "continue-prompt";
      prompt.textContent = "Finished this chapter? Pick the next move right here.";
      shell.appendChild(prompt);
    }

    const bar = document.createElement("div");
    bar.className = "traversal-bar";

    const { entries, prev, next } = getEntryContext();

    if (IS_MOBILE_READER) {
      bar.appendChild(
        makeTraversalPill(
          "← Previous",
          prev ? () => switchEntry(CURRENT_WORK.slug, prev.slug, false, { actionSource: "mobile-prev" }) : null,
          "",
          !prev
        )
      );

      bar.appendChild(
        makeTraversalPill("Search", () => {
          burstServeAds();
          scrollToSearchBar();
        })
      );

      bar.appendChild(
        makeTraversalPill(
          "Next →",
          next ? () => switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "mobile-next" }) : null,
          "",
          !next
        )
      );

      shell.appendChild(bar);
      return shell;
    }

    if (prev) {
      bar.appendChild(makeTraversalPill("← Previous", () => switchEntry(CURRENT_WORK.slug, prev.slug, false, { actionSource: "prev" })));
    }

    for (const entry of entries) {
      const isCurrent = normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug);
      const label = entry.subtitle || titleCaseSlug(entry.slug);
      bar.appendChild(
        makeTraversalPill(label, () => switchEntry(CURRENT_WORK.slug, entry.slug, false, { actionSource: "chapter-pill" }), isCurrent ? "current" : "")
      );
    }

    if (next) {
      bar.appendChild(makeTraversalPill("Next →", () => switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "next" })));
    }

    shell.appendChild(bar);
    return shell;
  }

  function updateChapterProgress(progress = 0) {
    const clamped = Math.max(0, Math.min(1, progress));
    const percent = Math.round(clamped * 100);

    const pageBar = document.getElementById("pageProgressBar");
    const fill = document.getElementById("chapterProgressFill");
    const label = document.getElementById("chapterProgressLabel");
    const text = document.getElementById("chapterProgressPercent");

    if (pageBar) pageBar.style.width = `${percent}%`;
    if (fill) fill.style.width = `${percent}%`;
    if (text) text.textContent = `${percent}%`;
    if (label) label.textContent = CURRENT_ENTRY?.subtitle || CURRENT_ITEM?.subtitle || "Chapter Progress";

    const bottomBtn = document.getElementById("scrollToBottomTraversalBtn");
    if (bottomBtn && clamped >= BOTTOM_GLOW_PROGRESS && !bottomGlowTriggered) {
      bottomGlowTriggered = true;
      bottomBtn.classList.add("pulse");
      burstServeAds();
    }

    if (bottomBtn && clamped < BOTTOM_GLOW_PROGRESS) {
      bottomGlowTriggered = false;
      bottomBtn.classList.remove("pulse");
    }
  }

  function wireStickyControls() {
    if (stickyControlsWired) return;
    stickyControlsWired = true;

    const topBtn = document.getElementById("scrollToSearchBtn");
    const bottomBtn = document.getElementById("scrollToBottomTraversalBtn");

    if (topBtn) {
      topBtn.addEventListener("click", () => {
        burstServeAds();
        scrollToSearchBar();
      });
    }

    if (bottomBtn) {
      bottomBtn.addEventListener("click", () => {
        burstServeAds();
        const target = document.getElementById("bottomTraversal") || document.getElementById("readerBottomAnchor");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function clearRefreshTimers() {
    if (railRefreshTimer) clearInterval(railRefreshTimer);
    if (bannerRefreshTimer) clearInterval(bannerRefreshTimer);
    if (betweenRefreshTimer) clearInterval(betweenRefreshTimer);
    railRefreshTimer = null;
    bannerRefreshTimer = null;
    betweenRefreshTimer = null;
  }

  function refreshVisibleRailSlots() {
    if (document.hidden || !CURRENT_ITEM || IS_MOBILE_READER) return false;

    const subids = getSubids(CURRENT_ITEM);
    let refreshed = false;

    LEFT_RAIL_IDS.forEach((id, index) => {
      const ok = refillSlotIfVisible(document.getElementById(id), ZONES.leftRail, subids.left, subids.work, index + 1);
      refreshed = refreshed || ok;
    });

    RIGHT_RAIL_IDS.forEach((id, index) => {
      const ok = refillSlotIfVisible(document.getElementById(id), ZONES.rightRail, subids.right, subids.work, index + 1);
      refreshed = refreshed || ok;
    });

    if (refreshed) serveAds();
    return refreshed;
  }

  function refreshVisibleTopBanner() {
    if (document.hidden || !CURRENT_ITEM || IS_MOBILE_READER) return false;

    const subids = getSubids(CURRENT_ITEM);
    const el = document.getElementById("topBannerSlot");
    const refreshed = refillSlotIfVisible(el, ZONES.topBanner, subids.top, subids.work, 1);

    if (refreshed) serveAds();
    return refreshed;
  }

  function refreshVisibleBetweenSlots() {
    if (document.hidden || !CURRENT_ITEM) return false;

    let refreshed = false;

    $$(".between-slot").forEach((el) => {
      const zoneId = Number(el.dataset.zoneId || 0);
      const sub = Number(el.dataset.sub || 1);
      const sub2 = Number(el.dataset.sub2 || 1);
      const sub3 = Number(el.dataset.sub3 || 1);
      if (!zoneId) return;

      const ok = refillSlotIfVisible(el, zoneId, sub, sub2, sub3);
      refreshed = refreshed || ok;
    });

    if (refreshed) serveAds();
    return refreshed;
  }

  function startRefreshTimers() {
    clearRefreshTimers();

    if (IS_MOBILE_READER) return;

    railRefreshTimer = window.setInterval(() => {
      refreshVisibleRailSlots();
    }, RAIL_REFRESH_MS);

    bannerRefreshTimer = window.setInterval(() => {
      refreshVisibleTopBanner();
    }, BANNER_REFRESH_MS);

    betweenRefreshTimer = window.setInterval(() => {
      refreshVisibleBetweenSlots();
    }, BETWEEN_REFRESH_MS);
  }

  function maybePreloadNextChapter() {
    if (nextPrefetch || !CURRENT_WORK || !CURRENT_ENTRY) return;

    const { next } = getEntryContext();
    if (!next) return;

    const itemUrl = getItemJsonUrl(CURRENT_WORK, next);

    nextPrefetch = fetchJson(itemUrl)
      .then(manifest => {
        const images = buildImageList(manifest).slice(0, 3);
        const base = normalizeBaseUrl(manifest.base_url);

        images.forEach(name => {
          const img = new Image();
          img.decoding = "async";
          img.src = `${base}/${name}`;
        });

        return manifest;
      })
      .catch(() => null);
  }

  function maybeServeVisibleReaderAds() {
    let refreshed = false;
    refreshed = refreshVisibleBetweenSlots() || refreshed;
    refreshed = refreshVisibleRailSlots() || refreshed;
    refreshed = refreshVisibleTopBanner() || refreshed;

    if (!refreshed) {
      const visibleBetween = $$(".between-slot").some(el => isElementInViewport(el));
      if (visibleBetween) {
        serveAds();
      }
    }
  }

  function wireProgressWatch() {
    if (progressWatchWired) return;
    progressWatchWired = true;

    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollable > 0 ? window.scrollY / scrollable : 0;

        updateChapterProgress(progress);

        if (progress >= READ_PROGRESS_PREFETCH) {
          maybePreloadNextChapter();
        }

        maybeServeVisibleReaderAds();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function buildChapterMeta(manifest, imageCount) {
    const meta = document.createElement("section");
    meta.className = "chapter-meta";

    const row = document.createElement("div");
    row.className = "meta-row";

    const leftTag = document.createElement("div");
    leftTag.className = "chapter-tag";
    leftTag.textContent = `${manifest.title || CURRENT_WORK.display || titleCaseSlug(CURRENT_WORK.slug)} · ${manifest.subtitle || CURRENT_ENTRY.subtitle || titleCaseSlug(CURRENT_ENTRY.slug)}`;

    const rightTag = document.createElement("div");
    rightTag.className = "chapter-tag";
    rightTag.textContent = `${imageCount} page${imageCount === 1 ? "" : "s"}`;

    row.appendChild(leftTag);
    row.appendChild(rightTag);

    const note = document.createElement("div");
    note.className = "chapter-note";
    note.textContent = IS_MOBILE_READER
      ? "Use the chapter controls above or below the pages whenever you want to jump fast."
      : "Use the search bar for instant jumps, keep the quick controls in view, and roll straight into the next chapter when you hit the end.";

    meta.appendChild(row);
    meta.appendChild(note);

    return meta;
  }

  function clearDesktopAdShells() {
    const topBanner = document.getElementById("topBannerSlot");
    if (topBanner) topBanner.innerHTML = "";

    [...LEFT_RAIL_IDS, ...RIGHT_RAIL_IDS].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  async function buildReader() {
    const reader = document.getElementById("reader");
    if (!reader) return;

    nextPrefetch = null;
    bottomGlowTriggered = false;
    updateChapterProgress(0);

    const state = getQueryState();
    let resolved = resolveSelection(state.dir, state.file);

    if (!resolved) {
      const first = getFirstEntry();
      resolved = first.work && first.entry ? first : null;
      if (resolved) setQueryState(resolved.work.slug, resolved.entry.slug, true);
    }

    if (!resolved) {
      throw new Error("No works found in library.json");
    }

    CURRENT_WORK = resolved.work;
    CURRENT_ENTRY = resolved.entry;

    if (IS_MOBILE_READER) {
      mobileOpenWorkSlug = resolved.work.slug;
    }

    const itemUrl = getItemJsonUrl(resolved.work, resolved.entry);
    const manifest = await fetchJson(itemUrl);
    CURRENT_ITEM = manifest;

    const title = `${resolved.work.display || titleCaseSlug(resolved.work.slug)} · ${manifest.subtitle || resolved.entry.subtitle || titleCaseSlug(resolved.entry.slug)}`;
    const workTitleEl = document.getElementById("workTitle");
    if (workTitleEl) workTitleEl.textContent = title;

    renderWorksNav();
    syncSearchSeed();

    const subids = getSubids(manifest);

    if (!IS_MOBILE_READER) {
      fillSlot(document.getElementById("topBannerSlot"), ZONES.topBanner, subids.top, subids.work, 1);
      fillRailStacks(subids);
    } else {
      clearDesktopAdShells();
    }

    reader.innerHTML = "";

    const topAnchor = document.createElement("span");
    topAnchor.id = "readerTopAnchor";
    topAnchor.className = "reader-anchor";
    reader.appendChild(topAnchor);

    const images = buildImageList(manifest);
    const base = normalizeBaseUrl(manifest.base_url);

    if (!base) throw new Error(`Manifest for ${resolved.entry.slug} is missing base_url`);
    if (!images.length) throw new Error(`Manifest for ${resolved.entry.slug} has no images`);

    reader.appendChild(buildChapterMeta(manifest, images.length));

    const note = document.createElement("div");
    note.className = "note";
    note.textContent = IS_MOBILE_READER
      ? "Tap through chapters up top, then just sink into the scroll."
      : "W̸e̴l̷c̷o̷m̷e̶ ̸B̴a̷c̸k̴,̷ ̶D̶e̸g̴e̶n̴e̴r̷a̸t̸e̷";
    reader.appendChild(note);

    reader.appendChild(buildTraversal("top"));

    const betweenEvery = IS_MOBILE_READER ? 2 : (Number(manifest.ads?.between_every) || 0);
    const betweenSlots = IS_MOBILE_READER ? 1 : (Number(manifest.ads?.between_slots) || 3);
    const finalBlock = IS_MOBILE_READER ? 0 : Math.max(Number(manifest.ads?.final_block) || 0, BOTTOM_AD_COUNT);

    let groupNumber = 0;

    for (let i = 0; i < images.length; i++) {
      reader.appendChild(
        imageBlock(
          `${base}/${images[i]}`,
          `${manifest.title || resolved.work.display || resolved.work.slug} page ${i + 1}`
        )
      );

      const pageNumber = i + 1;
      const shouldInsertBetween =
        betweenEvery > 0 &&
        pageNumber % betweenEvery === 0 &&
        pageNumber < images.length;

      if (shouldInsertBetween) {
        groupNumber += 1;
        reader.appendChild(betweenAd(manifest, groupNumber, betweenSlots));
      }
    }

    if (finalBlock > 0) {
      reader.appendChild(endAds(manifest, finalBlock));
    }

    reader.appendChild(buildTraversal("bottom"));

    const bottomAnchor = document.createElement("span");
    bottomAnchor.id = "readerBottomAnchor";
    bottomAnchor.className = "reader-anchor";
    reader.appendChild(bottomAnchor);

    setupAdVisibilityObserver();
    serveAds(true);
    startRefreshTimers();
    updateChapterProgress(0);

    // Extra serve shortly after build so lazy content / inserted ins blocks get another pass.
    window.setTimeout(() => serveAds(true), 900);

    if (IS_MOBILE_READER) {
      syncDialThumb();
    }
  }

  async function switchEntry(dir, file, replace = false, options = {}) {
    const { actionSource = "unknown" } = options;

    setQueryState(dir, file, replace);

    // Action-triggered ad burst before rebuild.
    if (actionSource) {
      burstServeAds();
    }

    await buildReader();

    // Action-triggered ad burst after rebuild.
    if (actionSource) {
      window.setTimeout(() => burstServeAds(), 600);
    }

    if (IS_MOBILE_READER) {
      scrollToReaderTop();
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function wireDocumentVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;

      // When the tab becomes visible again, re-serve and refresh visible slots.
      serveAds(true);
      window.setTimeout(() => {
        refreshVisibleTopBanner();
        refreshVisibleRailSlots();
        refreshVisibleBetweenSlots();
      }, 400);
    });
  }

  function wireReaderClickMonetization() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const hotSelectors = [
        ".image-wrap img",
        ".topworks-link",
        ".topworks-trigger",
        ".search-result-pill",
        ".traversal-pill",
        ".mobile-work-trigger",
        ".mobile-chapter-link",
        "#scrollToSearchBtn",
        "#scrollToBottomTraversalBtn"
      ];

      if (hotSelectors.some(sel => target.closest(sel))) {
        burstServeAds();
      }
    }, { passive: true });
  }

  async function boot() {
    await loadLibrary();

    wireTopFlyouts();
    wireStickyControls();
    wireProgressWatch();
    wireSearch();
    wireMobileWorksNav();
    wireMobileDial();
    wireDocumentVisibility();
    wireReaderClickMonetization();

    await buildReader();

    window.addEventListener("popstate", async () => {
      await buildReader();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch(err => {
      console.error(err);
      clearRefreshTimers();

      const workTitleEl = document.getElementById("workTitle");
      if (workTitleEl) workTitleEl.textContent = "Failed to load work";

      const reader = document.getElementById("reader");
      if (reader) {
        reader.innerHTML = `
          <div class="note">
            Failed to load this work. Please check library.json, sources, item.json, base_url, and image filenames.
          </div>
        `;
      }
    });
  });
})();
