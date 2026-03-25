(() => {
  "use strict";

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------

  const CONFIG = {
    libraryFile: "library.json",
    defaultWorksBase: "https://pub-cd01009a7c6c464aa0b093e33aa5ae51.r2.dev/works",
    itemJsonName: "item.json",

    bottomAdCount: 6,

    railRefreshMs: 45000,
    bannerRefreshMs: 60000,
    betweenRefreshMs: 50000,
    mobileStickyRefreshMs: 60000,

    readProgressPrefetch: 0.7,
    bottomGlowProgress: 0.95,
    searchResultsLimit: 12,

    minGlobalServeGapMs: 1200,
    minSlotRefreshGapMs: 30000,
    viewportThreshold: 0.2,

    interstitialDelayMs: 1200,
    videoSliderDelayMs: 5000,

    topTraversalWindow: 9,
    topTraversalEdgeCount: 2
  };

  const ZONES = {
    topBanner: 5865232,
    leftRail: 5865238,
    rightRail: 5865240,
    betweenMulti: 5867482
  };

  const SPECIAL_ZONES = {
    desktopInterstitial: {
      zoneId: 5880058,
      className: "eas6a97888e35",
      host: "https://a.pemsrv.com/ad-provider.js"
    },
    mobileInterstitial: {
      zoneId: 5880060,
      className: "eas6a97888e33",
      host: "https://a.pemsrv.com/ad-provider.js"
    },
    desktopVideoSlider: {
      zoneId: 5880066,
      className: "eas6a97888e31",
      host: "https://a.magsrv.com/ad-provider.js"
    },
    desktopRecommend: {
      zoneId: 5880068,
      className: "eas6a97888e20",
      host: "https://a.magsrv.com/ad-provider.js"
    },
    mobileSticky: {
      zoneId: 5880082,
      className: "eas6a97888e10",
      host: "https://a.magsrv.com/ad-provider.js"
    }
  };

  const LEFT_RAIL_IDS = [
    "leftRailSlot1","leftRailSlot2","leftRailSlot3","leftRailSlot4","leftRailSlot5","leftRailSlot6",
    "leftRailSlot7","leftRailSlot8","leftRailSlot9","leftRailSlot10","leftRailSlot11","leftRailSlot12"
  ];

  const RIGHT_RAIL_IDS = [
    "rightRailSlot1","rightRailSlot2","rightRailSlot3","rightRailSlot4","rightRailSlot5","rightRailSlot6",
    "rightRailSlot7","rightRailSlot8","rightRailSlot9","rightRailSlot10","rightRailSlot11","rightRailSlot12"
  ];

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------

  const STATE = {
    works: [],
    sourceMap: {},

    currentWork: null,
    currentEntry: null,
    currentItem: null,

    isMobileReader: document.body?.dataset?.readerMode === "mobile",

    topFlyoutsWired: false,
    stickyControlsWired: false,
    searchWired: false,
    mobileWorksWired: false,
    progressWatchWired: false,
    dialWired: false,

    railRefreshTimer: null,
    bannerRefreshTimer: null,
    betweenRefreshTimer: null,
    mobileStickyRefreshTimer: null,

    nextPrefetch: null,
    bottomGlowTriggered: false,
    mobileOpenWorkSlug: "",

    adServeScheduled: false,
    lastServeAt: 0,
    adVisibilityObserver: null,
    adActionBurstCooldownUntil: 0,

    providerLoadPromises: new Map(),

    videoSliderLoaded: false,
    videoSliderScheduled: false,
    mobileStickyLoaded: false,

    retentionToastTimer: null
  };

  // ------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function createEl(tag, className = "", text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  // ------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------

  function now() {
    return Date.now();
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function normalizeKey(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function normalizeBaseUrl(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function titleCaseSlug(slug) {
    return String(slug ?? "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function isElementInViewport(el, threshold = CONFIG.viewportThreshold) {
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
    return (now() - last) >= CONFIG.minSlotRefreshGapMs;
  }

  function stampSlotRefresh(el) {
    if (el) el.dataset.lastRefreshAt = String(now());
  }

  function markSlotSeen(el) {
    if (el) el.dataset.seen = "1";
  }

  // ------------------------------------------------------------
  // Source / item resolution
  // ------------------------------------------------------------

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
    const safeParts = path.split("/").filter(Boolean).map(part => encodeURIComponent(part));

    return `${getWorkBase(work, entry)}/${encodeURIComponent(work.slug)}/${safeParts.join("/")}/${CONFIG.itemJsonName}`;
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

  // ------------------------------------------------------------
  // Query state
  // ------------------------------------------------------------

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
    for (const work of STATE.works) {
      const first = Array.isArray(work.entries) ? work.entries[0] : null;
      if (work?.slug && first?.slug) return { work, entry: first };
    }
    return { work: null, entry: null };
  }

  function resolveSelection(dir, file) {
    const d = normalizeKey(dir);
    const f = normalizeKey(file);

    for (const work of STATE.works) {
      if (normalizeKey(work.slug) !== d) continue;
      for (const entry of work.entries || []) {
        if (normalizeKey(entry.slug) === f) {
          return { work, entry };
        }
      }
    }

    return null;
  }

  function getEntryContext() {
    const entries = Array.isArray(STATE.currentWork?.entries) ? STATE.currentWork.entries : [];
    const currentIndex = entries.findIndex(entry => normalizeKey(entry.slug) === normalizeKey(STATE.currentEntry?.slug));

    return {
      entries,
      currentIndex,
      prev: currentIndex > 0 ? entries[currentIndex - 1] : null,
      next: currentIndex >= 0 && currentIndex < entries.length - 1 ? entries[currentIndex + 1] : null
    };
  }

  function getCurrentChapterPosition() {
    const { currentIndex } = getEntryContext();
    return currentIndex >= 0 ? currentIndex + 1 : 0;
  }

  // ------------------------------------------------------------
  // Scroll targets
  // ------------------------------------------------------------

  function scrollToReaderTopInstant() {
    const target =
      document.getElementById("readerTopAnchor") ||
      document.getElementById("reader") ||
      document.getElementById("searchBarAnchor");

    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function scrollToReaderContentStartInstant() {
    const target =
      document.getElementById("readerContentStartAnchor") ||
      document.getElementById("readerTopAnchor") ||
      document.getElementById("reader");

    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function scrollToSearchBar() {
    const target = document.getElementById("searchBarAnchor") || document.querySelector(".hero");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url} (${res.status})`);
    }
    return res.json();
  }

  async function loadLibrary() {
    const data = await fetchJson(CONFIG.libraryFile);
    STATE.works = Array.isArray(data.works) ? data.works : [];
    STATE.sourceMap = data && typeof data.sources === "object" && data.sources ? data.sources : {};
  }

  // ------------------------------------------------------------
  // Ads
  // ------------------------------------------------------------

  function rawServeAds() {
    (window.AdProvider = window.AdProvider || []).push({ serve: {} });
    STATE.lastServeAt = now();
    STATE.adServeScheduled = false;
  }

  function serveAds(force = false) {
    const elapsed = now() - STATE.lastServeAt;

    if (force || elapsed >= CONFIG.minGlobalServeGapMs) {
      rawServeAds();
      return;
    }

    if (STATE.adServeScheduled) return;
    STATE.adServeScheduled = true;

    window.setTimeout(() => rawServeAds(), Math.max(0, CONFIG.minGlobalServeGapMs - elapsed));
  }

  function burstServeAds() {
    if (document.hidden) return;
    if (now() < STATE.adActionBurstCooldownUntil) return;

    STATE.adActionBurstCooldownUntil = now() + 3500;
    serveAds(true);
    window.setTimeout(() => serveAds(true), 700);
  }

  function ensureAdProviderScript(src) {
    if (!src) return Promise.resolve();

    if (STATE.providerLoadPromises.has(src)) {
      return STATE.providerLoadPromises.get(src);
    }

    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      const ready = Promise.resolve();
      STATE.providerLoadPromises.set(src, ready);
      return ready;
    }

    const promise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.async = true;
      s.type = "application/javascript";
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ad provider: ${src}`));
      document.head.appendChild(s);
    });

    STATE.providerLoadPromises.set(src, promise);
    return promise;
  }

  function makeIns(zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    const ins = document.createElement("ins");
    ins.className = className;
    ins.setAttribute("data-zoneid", String(zoneId));
    ins.setAttribute("data-sub", String(sub));
    ins.setAttribute("data-sub2", String(sub2));
    ins.setAttribute("data-sub3", String(sub3));
    return ins;
  }

  function makeSpecialIns(zoneId, className) {
    const ins = document.createElement("ins");
    ins.className = className;
    ins.setAttribute("data-zoneid", String(zoneId));
    return ins;
  }

  function refillSlot(el, zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    if (!el) return;
    el.innerHTML = "";
    el.appendChild(makeIns(zoneId, sub, sub2, sub3, className));
    stampSlotRefresh(el);
  }

  function fillSlot(el, zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    if (!el) return;
    refillSlot(el, zoneId, sub, sub2, sub3, className);
    serveAds();
  }

  function refillSlotIfVisible(el, zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    if (!el || document.hidden) return false;
    if (!isElementInViewport(el)) return false;
    if (!canRefreshSlot(el)) return false;

    refillSlot(el, zoneId, sub, sub2, sub3, className);
    markSlotSeen(el);
    return true;
  }

  function createRuntimeMount(id) {
    const mount = document.createElement("div");
    mount.id = id;
    mount.style.position = "relative";
    mount.style.width = "0";
    mount.style.height = "0";
    mount.style.overflow = "visible";
    mount.style.zIndex = "999999";
    return mount;
  }

  async function mountRuntimeSpecial(id, cfg) {
    if (!cfg) return null;
    await ensureAdProviderScript(cfg.host);

    let mount = document.getElementById(id);
    if (!mount) {
      mount = createRuntimeMount(id);
      document.body.appendChild(mount);
    }

    mount.innerHTML = "";
    mount.appendChild(makeSpecialIns(cfg.zoneId, cfg.className));
    serveAds(true);
    return mount;
  }

  async function fireChapterInterstitial() {
    const cfg = STATE.isMobileReader ? SPECIAL_ZONES.mobileInterstitial : SPECIAL_ZONES.desktopInterstitial;
    const id = STATE.isMobileReader ? "runtime-mobile-interstitial" : "runtime-desktop-interstitial";

    await mountRuntimeSpecial(id, cfg);
    await delay(CONFIG.interstitialDelayMs);
  }

  async function loadMobileStickyBanner(force = false) {
    if (!STATE.isMobileReader) return;

    const mount = document.getElementById("mobileStickyMount");
    if (!mount) return;
    if (STATE.mobileStickyLoaded && !force) return;

    await ensureAdProviderScript(SPECIAL_ZONES.mobileSticky.host);
    mount.innerHTML = "";
    mount.appendChild(
      makeSpecialIns(SPECIAL_ZONES.mobileSticky.zoneId, SPECIAL_ZONES.mobileSticky.className)
    );
    stampSlotRefresh(mount);
    serveAds(true);
    STATE.mobileStickyLoaded = true;
  }

  function positionDesktopStickyAwayFromVideo() {
    if (STATE.isMobileReader) return;

    const stickyCluster = document.getElementById("stickyCluster");
    const progressChip = document.querySelector(".chapter-progress-chip");

    if (stickyCluster) {
      stickyCluster.style.right = "auto";
      stickyCluster.style.left = "18px";
      stickyCluster.style.bottom = "18px";
    }

    if (progressChip) {
      progressChip.style.left = "18px";
      progressChip.style.right = "auto";
      progressChip.style.bottom = "140px";
    }
  }

  function scheduleVideoSlider() {
    if (STATE.isMobileReader || STATE.videoSliderLoaded || STATE.videoSliderScheduled) return;

    STATE.videoSliderScheduled = true;

    window.setTimeout(async () => {
      if (STATE.videoSliderLoaded) return;
      await mountRuntimeSpecial("runtime-desktop-video-slider", SPECIAL_ZONES.desktopVideoSlider);
      STATE.videoSliderLoaded = true;
      positionDesktopStickyAwayFromVideo();
    }, CONFIG.videoSliderDelayMs);
  }

  function setupAdVisibilityObserver() {
    if (STATE.adVisibilityObserver) {
      STATE.adVisibilityObserver.disconnect();
      STATE.adVisibilityObserver = null;
    }

    STATE.adVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target) markSlotSeen(entry.target);
      }
    }, {
      root: null,
      threshold: [0.2, 0.5]
    });

    $$(".slot, .top-banner-inner").forEach(el => STATE.adVisibilityObserver.observe(el));
  }

  function refreshVisibleRailSlots() {
    if (document.hidden || !STATE.currentItem || STATE.isMobileReader) return false;

    const subids = getSubids(STATE.currentItem);
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
    if (document.hidden || !STATE.currentItem || STATE.isMobileReader) return false;

    const subids = getSubids(STATE.currentItem);
    const el = document.getElementById("topBannerSlot");
    const refreshed = refillSlotIfVisible(el, ZONES.topBanner, subids.top, subids.work, 1);

    if (refreshed) serveAds();
    return refreshed;
  }

  function refreshVisibleBetweenSlots() {
    if (document.hidden || !STATE.currentItem) return false;

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

  async function refreshMobileSticky() {
    if (!STATE.isMobileReader) return false;

    const mount = document.getElementById("mobileStickyMount");
    if (!mount || document.hidden) return false;
    if (!canRefreshSlot(mount)) return false;

    await loadMobileStickyBanner(true);
    return true;
  }

  function clearRefreshTimers() {
    if (STATE.railRefreshTimer) clearInterval(STATE.railRefreshTimer);
    if (STATE.bannerRefreshTimer) clearInterval(STATE.bannerRefreshTimer);
    if (STATE.betweenRefreshTimer) clearInterval(STATE.betweenRefreshTimer);
    if (STATE.mobileStickyRefreshTimer) clearInterval(STATE.mobileStickyRefreshTimer);

    STATE.railRefreshTimer = null;
    STATE.bannerRefreshTimer = null;
    STATE.betweenRefreshTimer = null;
    STATE.mobileStickyRefreshTimer = null;
  }

  function startRefreshTimers() {
    clearRefreshTimers();

    if (!STATE.isMobileReader) {
      STATE.railRefreshTimer = window.setInterval(refreshVisibleRailSlots, CONFIG.railRefreshMs);
      STATE.bannerRefreshTimer = window.setInterval(refreshVisibleTopBanner, CONFIG.bannerRefreshMs);
      STATE.betweenRefreshTimer = window.setInterval(refreshVisibleBetweenSlots, CONFIG.betweenRefreshMs);
      return;
    }

    STATE.mobileStickyRefreshTimer = window.setInterval(refreshMobileSticky, CONFIG.mobileStickyRefreshMs);
  }

  function clearDesktopAdShells() {
    const topBanner = document.getElementById("topBannerSlot");
    if (topBanner) topBanner.innerHTML = "";

    [...LEFT_RAIL_IDS, ...RIGHT_RAIL_IDS].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  // ------------------------------------------------------------
  // Mobile dial
  // ------------------------------------------------------------

  function syncDialThumb() {
    if (!STATE.isMobileReader) return;

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
    if (!STATE.isMobileReader || STATE.dialWired) return;
    STATE.dialWired = true;

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

  // ------------------------------------------------------------
  // Search
  // ------------------------------------------------------------

  function flattenEntries() {
    const rows = [];
    for (const work of STATE.works) {
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
      stat.textContent = STATE.isMobileReader ? "Type to search" : "No matches yet";
      return;
    }

    stat.textContent = `${items.length} quick jump${items.length === 1 ? "" : "s"}`;
    results.innerHTML = items.map(item => `
      <button class="search-result-pill" type="button" data-dir="${escapeHtml(item.workSlug)}" data-file="${escapeHtml(item.entrySlug)}">
        ${escapeHtml(item.workLabel)} · ${escapeHtml(item.entryLabel)}
      </button>
    `).join("");
  }

  function syncSearchSeed() {
    const input = document.getElementById("chapterSearchInput");
    const stat = document.getElementById("chapterSearchStat");
    const results = document.getElementById("chapterSearchResults");
    if (!input || !stat || !results) return;
    if (input.value.trim()) return;

    if (STATE.isMobileReader) {
      results.innerHTML = "";
      stat.textContent = "Type to search";
      return;
    }

    const seeded = flattenEntries()
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

    const all = flattenEntries();

    const refresh = () => {
      const query = normalizeKey(input.value);

      if (!query) {
        if (STATE.isMobileReader) {
          results.innerHTML = "";
          stat.textContent = "Type to search";
          return;
        }

        const seeded = all
          .filter(item => item.workSlug === STATE.currentWork?.slug)
          .slice(0, CONFIG.searchResultsLimit);

        renderSearchResults(seeded);
        stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
        return;
      }

      const matched = all
        .filter(item => item.searchKey.includes(query))
        .slice(0, CONFIG.searchResultsLimit);

      renderSearchResults(matched);
      stat.textContent = matched.length ? `${matched.length} result${matched.length === 1 ? "" : "s"}` : "No matches";
    };

    input.addEventListener("input", refresh);
    input.addEventListener("focus", burstServeAds);

    results.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-dir][data-file]");
      if (!btn) return;

      input.value = "";

      if (STATE.isMobileReader) {
        results.innerHTML = "";
        stat.textContent = "Type to search";
        setMobileOpenWork(btn.dataset.dir);
      }

      burstServeAds();
      await switchEntry(btn.dataset.dir, btn.dataset.file, false, { actionSource: "search" });

      if (STATE.isMobileReader) scrollToReaderContentStartInstant();
    });

    refresh();
  }

  // ------------------------------------------------------------
  // Works nav
  // ------------------------------------------------------------

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
              ${escapeHtml(entry.subtitle || titleCaseSlug(entry.slug))}
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
          <button class="topworks-trigger" type="button">
            <span>${escapeHtml(work.display || titleCaseSlug(work.slug))}</span>
            <span class="topworks-caret"></span>
          </button>
          <div class="topworks-flyout">
            <div class="topworks-links">
      `;

      for (const entry of entries) {
        const label = `${work.display || titleCaseSlug(work.slug)} · ${entry.subtitle || titleCaseSlug(entry.slug)}`;
        const active = isActive && normalizeKey(entry.slug) === normalizeKey(STATE.currentEntry?.slug) ? " active" : "";

        html += `
          <a href="?dir=${encodeURIComponent(work.slug)}&file=${encodeURIComponent(entry.slug)}" class="topworks-link${active}" data-dir="${escapeHtml(work.slug)}" data-file="${escapeHtml(entry.slug)}">
            ${escapeHtml(label)}
          </a>
        `;
      }

      html += `</div></div></div>`;
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
    if (STATE.topFlyoutsWired) return;
    STATE.topFlyoutsWired = true;

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
    if (!STATE.isMobileReader || STATE.mobileWorksWired) return;
    STATE.mobileWorksWired = true;

    const nav = document.getElementById("worksNav");
    if (!nav) return;

    nav.addEventListener("click", async (e) => {
      const toggle = e.target.closest("[data-work-toggle]");
      if (toggle) {
        const slug = toggle.dataset.workToggle;
        const normalized = normalizeKey(slug);
        const isAlreadyOpen = normalized === normalizeKey(STATE.mobileOpenWorkSlug);

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
      scrollToReaderContentStartInstant();
    });
  }

  // ------------------------------------------------------------
  // Reader content blocks
  // ------------------------------------------------------------

  function imageBlock(src, alt) {
    const wrap = createEl("div", "image-wrap");
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
    const wrap = createEl("div", "between-grid");

    for (let i = 1; i <= slotCount; i++) {
      const slot = createEl("div", "slot between-slot");
      slot.dataset.zoneType = "between";
      slot.dataset.zoneId = String(ZONES.betweenMulti);
      slot.dataset.sub = String(subids.between);
      slot.dataset.sub2 = String(subids.work);
      slot.dataset.sub3 = String(Number(`${groupNumber}${i}`));

      slot.appendChild(makeIns(ZONES.betweenMulti, subids.between, subids.work, Number(`${groupNumber}${i}`)));
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function endAds(manifest, count) {
    const subids = getSubids(manifest);
    const wrap = createEl("div", "end-grid");

    for (let i = 1; i <= count; i++) {
      const slot = createEl("div", "slot between-slot");
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

  function buildRecommendationWidget() {
    if (STATE.isMobileReader) return null;

    const shell = createEl("section", "recommend-shell");
    const title = createEl("p", "recommend-title", "More To Read");
    const slot = createEl("div", "slot recommend-slot");

    slot.appendChild(
      makeSpecialIns(SPECIAL_ZONES.desktopRecommend.zoneId, SPECIAL_ZONES.desktopRecommend.className)
    );

    shell.appendChild(title);
    shell.appendChild(slot);
    return shell;
  }

  function buildChapterMeta(manifest, imageCount) {
    const meta = createEl("section", "chapter-meta");
    const row = createEl("div", "meta-row");

    const chapterNo = getCurrentChapterPosition();

    const leftTag = createEl(
      "div",
      "chapter-tag",
      `${manifest.title || STATE.currentWork.display || titleCaseSlug(STATE.currentWork.slug)} · ${manifest.subtitle || STATE.currentEntry.subtitle || titleCaseSlug(STATE.currentEntry.slug)}${chapterNo ? ` · #${chapterNo}` : ""}`
    );

    const rightTag = createEl("div", "chapter-tag", `${imageCount} page${imageCount === 1 ? "" : "s"}`);

    const note = createEl(
      "div",
      "chapter-note",
      STATE.isMobileReader
        ? "Use the chapter controls above or below the pages whenever you want to jump fast."
        : "Keep reading. Use the bottom controls to roll straight into the next chapter without losing momentum."
    );

    row.appendChild(leftTag);
    row.appendChild(rightTag);
    meta.appendChild(row);
    meta.appendChild(note);

    return meta;
  }

  // ------------------------------------------------------------
  // Traversal
  // ------------------------------------------------------------

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

  function createCompactEntryWindow(entries, currentIndex) {
    const result = [];
    const total = entries.length;

    if (total <= CONFIG.topTraversalWindow + (CONFIG.topTraversalEdgeCount * 2)) {
      return entries.map((entry, index) => ({ type: "entry", entry, index }));
    }

    const half = Math.floor(CONFIG.topTraversalWindow / 2);
    const start = Math.max(CONFIG.topTraversalEdgeCount, currentIndex - half);
    const end = Math.min(total - CONFIG.topTraversalEdgeCount - 1, currentIndex + half);

    const pushEntry = (entry, index) => result.push({ type: "entry", entry, index });
    const pushGap = (key) => result.push({ type: "gap", key });

    for (let i = 0; i < CONFIG.topTraversalEdgeCount; i++) {
      pushEntry(entries[i], i);
    }

    if (start > CONFIG.topTraversalEdgeCount) pushGap("left-gap");

    for (let i = start; i <= end; i++) {
      pushEntry(entries[i], i);
    }

    if (end < total - CONFIG.topTraversalEdgeCount - 1) pushGap("right-gap");

    for (let i = total - CONFIG.topTraversalEdgeCount; i < total; i++) {
      pushEntry(entries[i], i);
    }

    const deduped = [];
    const seen = new Set();

    for (const item of result) {
      if (item.type === "gap") {
        if (deduped.length && deduped[deduped.length - 1].type !== "gap") {
          deduped.push(item);
        }
        continue;
      }

      const key = `${item.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    if (deduped[deduped.length - 1]?.type === "gap") {
      deduped.pop();
    }

    return deduped;
  }

  function buildDesktopTopTraversal(entries, currentIndex, prev, next) {
    const shell = createEl("section", "traversal-shell top");
    const kicker = createEl("p", "traversal-kicker", "Chapter Navigation");
    const bar = createEl("div", "traversal-bar compact");

    shell.appendChild(kicker);

    bar.appendChild(
      makeTraversalPill(
        "← Previous",
        prev ? () => switchEntry(STATE.currentWork.slug, prev.slug, false, { actionSource: "prev" }) : null,
        "",
        !prev
      )
    );

    const currentLabel = STATE.currentEntry?.subtitle || titleCaseSlug(STATE.currentEntry?.slug);
    const currentBtn = makeTraversalPill(currentLabel, () => {
      const bottom = document.getElementById("bottomTraversal");
      if (bottom) bottom.scrollIntoView({ behavior: "smooth", block: "start" });
    }, "current jump-full");
    bar.appendChild(currentBtn);

    const windowed = createCompactEntryWindow(entries, currentIndex);
    for (const item of windowed) {
      if (item.type === "gap") {
        const gap = createEl("span", "traversal-gap", "…");
        bar.appendChild(gap);
        continue;
      }

      const isCurrent = item.index === currentIndex;
      const label = item.entry.subtitle || titleCaseSlug(item.entry.slug);
      bar.appendChild(
        makeTraversalPill(
          label,
          () => switchEntry(STATE.currentWork.slug, item.entry.slug, false, { actionSource: "chapter-pill-top" }),
          isCurrent ? "current" : ""
        )
      );
    }

    bar.appendChild(
      makeTraversalPill(
        next ? `Next: ${next.subtitle || titleCaseSlug(next.slug)}` : "Next →",
        next ? () => switchEntry(STATE.currentWork.slug, next.slug, false, { actionSource: "next" }) : null,
        "",
        !next
      )
    );

    shell.appendChild(bar);
    return shell;
  }

  function buildBottomTraversal(entries, currentIndex, prev, next) {
    const shell = createEl("section", "traversal-shell bottom");
    shell.id = "bottomTraversal";

    const kicker = createEl(
      "p",
      "traversal-kicker",
      STATE.isMobileReader ? "Quick Chapter Jump" : "Keep The Scroll Alive"
    );
    shell.appendChild(kicker);

    if (!STATE.isMobileReader) {
      const prompt = createEl(
        "div",
        "continue-prompt",
        next
          ? `Finished this chapter? Continue straight into ${next.subtitle || titleCaseSlug(next.slug)}.`
          : "Finished this chapter? Pick your next move right here."
      );
      shell.appendChild(prompt);
    }

    const bar = createEl("div", "traversal-bar");

    if (STATE.isMobileReader) {
      bar.appendChild(
        makeTraversalPill(
          "← Previous",
          prev ? () => switchEntry(STATE.currentWork.slug, prev.slug, false, { actionSource: "mobile-prev" }) : null,
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
          next ? `Next: ${next.subtitle || titleCaseSlug(next.slug)}` : "Next →",
          next ? () => switchEntry(STATE.currentWork.slug, next.slug, false, { actionSource: "mobile-next" }) : null,
          "",
          !next
        )
      );

      shell.appendChild(bar);
      return shell;
    }

    if (prev) {
      bar.appendChild(
        makeTraversalPill("← Previous", () => switchEntry(STATE.currentWork.slug, prev.slug, false, { actionSource: "prev-bottom" }))
      );
    }

    for (const entry of entries) {
      const isCurrent = normalizeKey(entry.slug) === normalizeKey(STATE.currentEntry?.slug);
      const label = entry.subtitle || titleCaseSlug(entry.slug);

      bar.appendChild(
        makeTraversalPill(
          label,
          () => switchEntry(STATE.currentWork.slug, entry.slug, false, { actionSource: "chapter-pill-bottom" }),
          isCurrent ? "current" : ""
        )
      );
    }

    if (next) {
      bar.appendChild(
        makeTraversalPill(
          `Next: ${next.subtitle || titleCaseSlug(next.slug)}`,
          () => switchEntry(STATE.currentWork.slug, next.slug, false, { actionSource: "next-bottom" })
        )
      );
    }

    shell.appendChild(bar);
    return shell;
  }

  function buildTraversal(position = "top") {
    const { entries, currentIndex, prev, next } = getEntryContext();

    if (position === "top" && !STATE.isMobileReader) {
      return buildDesktopTopTraversal(entries, currentIndex, prev, next);
    }

    return buildBottomTraversal(entries, currentIndex, prev, next);
  }

  // ------------------------------------------------------------
  // Progress / sticky controls
  // ------------------------------------------------------------

  function updateStickyBottomAction(progress = 0) {
    const btn = document.getElementById("scrollToBottomTraversalBtn");
    if (!btn) return;

    const { next } = getEntryContext();

    if (progress >= 0.9 && next) {
      btn.textContent = `Continue: ${next.subtitle || titleCaseSlug(next.slug)}`;
      btn.onclick = async () => {
        burstServeAds();
        await switchEntry(STATE.currentWork.slug, next.slug, false, { actionSource: "sticky-next" });
      };
      return;
    }

    btn.textContent = "Last Page | Traversal Options";
    btn.onclick = () => {
      burstServeAds();
      const target = document.getElementById("bottomTraversal") || document.getElementById("readerBottomAnchor");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function showRetentionToast(message) {
    if (STATE.isMobileReader) return;

    let toast = document.getElementById("readerRetentionToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "readerRetentionToast";
      toast.style.position = "fixed";
      toast.style.top = "18px";
      toast.style.right = "18px";
      toast.style.zIndex = "7001";
      toast.style.padding = "12px 14px";
      toast.style.border = "1px solid rgba(255,255,255,.14)";
      toast.style.borderRadius = "16px";
      toast.style.background = "rgba(12,14,20,.88)";
      toast.style.backdropFilter = "blur(14px)";
      toast.style.boxShadow = "0 18px 50px rgba(0,0,0,.35)";
      toast.style.color = "#f7f8fb";
      toast.style.fontFamily = '"Handjet", system-ui, sans-serif';
      toast.style.fontSize = "16px";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      toast.style.transition = "opacity .18s ease, transform .18s ease";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    if (STATE.retentionToastTimer) clearTimeout(STATE.retentionToastTimer);
    STATE.retentionToastTimer = window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
    }, 1200);
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

    if (label) {
      const chapterNo = getCurrentChapterPosition();
      const baseLabel = STATE.currentEntry?.subtitle || STATE.currentItem?.subtitle || "Chapter Progress";
      label.textContent = chapterNo ? `Chapter ${chapterNo} · ${baseLabel}` : baseLabel;
    }

    updateStickyBottomAction(clamped);

    const bottomBtn = document.getElementById("scrollToBottomTraversalBtn");
    if (bottomBtn && clamped >= CONFIG.bottomGlowProgress && !STATE.bottomGlowTriggered) {
      STATE.bottomGlowTriggered = true;
      bottomBtn.classList.add("pulse");
      burstServeAds();
    }

    if (bottomBtn && clamped < CONFIG.bottomGlowProgress) {
      STATE.bottomGlowTriggered = false;
      bottomBtn.classList.remove("pulse");
    }
  }

  function wireStickyControls() {
    if (STATE.stickyControlsWired) return;
    STATE.stickyControlsWired = true;

    const topBtn = document.getElementById("scrollToSearchBtn");
    if (topBtn) {
      topBtn.addEventListener("click", () => {
        burstServeAds();
        scrollToSearchBar();
      });
    }

    updateStickyBottomAction(0);
  }

  // ------------------------------------------------------------
  // Prefetch / reader ad checks
  // ------------------------------------------------------------

  function maybePreloadNextChapter() {
    if (STATE.nextPrefetch || !STATE.currentWork || !STATE.currentEntry) return;

    const { next } = getEntryContext();
    if (!next) return;

    const itemUrl = getItemJsonUrl(STATE.currentWork, next);

    STATE.nextPrefetch = fetchJson(itemUrl)
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
      if (visibleBetween) serveAds();
    }
  }

  function wireProgressWatch() {
    if (STATE.progressWatchWired) return;
    STATE.progressWatchWired = true;

    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollable > 0 ? window.scrollY / scrollable : 0;

        updateChapterProgress(progress);

        if (progress >= CONFIG.readProgressPrefetch) {
          maybePreloadNextChapter();
        }

        maybeServeVisibleReaderAds();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ------------------------------------------------------------
  // Reader build / navigation
  // ------------------------------------------------------------

  function shouldShowInterstitial(dir, file, options = {}) {
    if (options.skipInterstitial) return false;

    const selection = resolveSelection(dir, file);
    if (!selection) return false;

    const entries = Array.isArray(selection.work?.entries) ? selection.work.entries : [];
    const targetIndex = entries.findIndex(entry => normalizeKey(entry.slug) === normalizeKey(file));

    if (targetIndex < 3) return false;

    const isDifferentChapter =
      normalizeKey(dir) !== normalizeKey(STATE.currentWork?.slug) ||
      normalizeKey(file) !== normalizeKey(STATE.currentEntry?.slug);

    if (!isDifferentChapter) return false;
    return true;
  }

  function fillRailStacks(subids) {
    LEFT_RAIL_IDS.forEach((id, index) => {
      fillSlot(document.getElementById(id), ZONES.leftRail, subids.left, subids.work, index + 1);
    });

    RIGHT_RAIL_IDS.forEach((id, index) => {
      fillSlot(document.getElementById(id), ZONES.rightRail, subids.right, subids.work, index + 1);
    });
  }

  async function buildReader() {
    const reader = document.getElementById("reader");
    if (!reader) return;

    STATE.nextPrefetch = null;
    STATE.bottomGlowTriggered = false;
    updateChapterProgress(0);

    const state = getQueryState();
    let resolved = resolveSelection(state.dir, state.file);

    if (!resolved) {
      const first = getFirstEntry();
      resolved = first.work && first.entry ? first : null;
      if (resolved) setQueryState(resolved.work.slug, resolved.entry.slug, true);
    }

    if (!resolved) throw new Error("No works found in library.json");

    STATE.currentWork = resolved.work;
    STATE.currentEntry = resolved.entry;

    if (STATE.isMobileReader) {
      STATE.mobileOpenWorkSlug = resolved.work.slug;
    }

    const itemUrl = getItemJsonUrl(resolved.work, resolved.entry);
    const manifest = await fetchJson(itemUrl);
    STATE.currentItem = manifest;

    const images = buildImageList(manifest);
    const base = normalizeBaseUrl(manifest.base_url);
    if (!base) throw new Error(`Manifest for ${resolved.entry.slug} is missing base_url`);
    if (!images.length) throw new Error(`Manifest for ${resolved.entry.slug} has no images`);

    const workTitleEl = document.getElementById("workTitle");
    if (workTitleEl) {
      workTitleEl.textContent = `${resolved.work.display || titleCaseSlug(resolved.work.slug)} · ${manifest.subtitle || resolved.entry.subtitle || titleCaseSlug(resolved.entry.slug)}`;
    }

    renderWorksNav();
    syncSearchSeed();

    const subids = getSubids(manifest);

    if (!STATE.isMobileReader) {
      fillSlot(document.getElementById("topBannerSlot"), ZONES.topBanner, subids.top, subids.work, 1);
      fillRailStacks(subids);
      scheduleVideoSlider();
      positionDesktopStickyAwayFromVideo();
    } else {
      clearDesktopAdShells();
      await loadMobileStickyBanner();
    }

    reader.innerHTML = "";

    const topAnchor = createEl("span", "reader-anchor");
    topAnchor.id = "readerTopAnchor";
    reader.appendChild(topAnchor);

    reader.appendChild(buildChapterMeta(manifest, images.length));

    const note = createEl(
      "div",
      "note",
      STATE.isMobileReader
        ? "Tap through chapters up top, then just sink into the scroll."
        : "Stay in the flow. Bottom controls keep you moving into the next chapter fast."
    );
    reader.appendChild(note);

    reader.appendChild(buildTraversal("top"));

    const contentStartAnchor = createEl("span", "reader-anchor");
    contentStartAnchor.id = "readerContentStartAnchor";
    reader.appendChild(contentStartAnchor);

    const betweenEvery = STATE.isMobileReader ? 2 : (Number(manifest.ads?.between_every) || 0);
    const betweenSlots = STATE.isMobileReader ? 1 : (Number(manifest.ads?.between_slots) || 3);
    const finalBlock = STATE.isMobileReader ? 0 : Math.max(Number(manifest.ads?.final_block) || 0, CONFIG.bottomAdCount);

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

    const recommend = buildRecommendationWidget();
    if (recommend) {
      reader.appendChild(recommend);
      await ensureAdProviderScript(SPECIAL_ZONES.desktopRecommend.host);
    }

    const bottomAnchor = createEl("span", "reader-anchor");
    bottomAnchor.id = "readerBottomAnchor";
    reader.appendChild(bottomAnchor);

    setupAdVisibilityObserver();
    serveAds(true);
    startRefreshTimers();
    updateChapterProgress(0);

    window.setTimeout(() => serveAds(true), 900);

    if (STATE.isMobileReader) syncDialThumb();
  }

  async function switchEntry(dir, file, replace = false, options = {}) {
    const { actionSource = "unknown" } = options;

    if (shouldShowInterstitial(dir, file, options)) {
      await fireChapterInterstitial();
    }

    setQueryState(dir, file, replace);

    if (actionSource) burstServeAds();

    await buildReader();

    if (actionSource) {
      window.setTimeout(() => burstServeAds(), 600);
    }

    scrollToReaderContentStartInstant();
    showRetentionToast(`Now reading: ${STATE.currentEntry?.subtitle || titleCaseSlug(file)}`);
  }

  // ------------------------------------------------------------
  // Events
  // ------------------------------------------------------------

  function wireDocumentVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;

      serveAds(true);
      window.setTimeout(() => {
        refreshVisibleTopBanner();
        refreshVisibleRailSlots();
        refreshVisibleBetweenSlots();
        refreshMobileSticky();
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

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------

  async function boot() {
    await Promise.all([
      ensureAdProviderScript("https://a.magsrv.com/ad-provider.js"),
      ensureAdProviderScript("https://a.pemsrv.com/ad-provider.js")
    ]);

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
      scrollToReaderContentStartInstant();
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
