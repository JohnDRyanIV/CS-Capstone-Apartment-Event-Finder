mapboxgl.accessToken = window.MAPBOX_TOKEN;
mapboxgl.config.EVENTS_URL = '';

const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: [-93.6250, 41.5868],
    zoom: 11
});



// ── Icons ──────────────────────────────────────────────────────────────────────
const pinIcon   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
const calIcon   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const phoneIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.93 5.18 2 2 0 012.92 3h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 10.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`;

// ── Helpers ────────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeHtml(text) {
    if (!text) return "";
    const ta = document.createElement("textarea");
    ta.innerHTML = String(text);
    return ta.value;
}

function extractPriceNumber(priceText) {
    if (!priceText) return null;
    const matches = String(priceText).match(/\d[\d,]*/g);
    if (!matches || matches.length === 0) return null;
    const values = matches.map(v => Number(v.replace(/,/g, ""))).filter(v => !Number.isNaN(v));
    return values.length === 0 ? null : Math.min(...values);
}

function getApartmentMinPrice(apt) {
    if (!apt.rent_by_bed) return null;
    const prices = Object.values(apt.rent_by_bed).map(extractPriceNumber).filter(v => v !== null);
    return prices.length === 0 ? null : Math.min(...prices);
}

function hasReadablePrice(apt) {
    // Filter out "call for info" listings and outliers over $5,000
    const min = getApartmentMinPrice(apt);
    return min !== null && min <= 5000;
}

function aptMatchesBeds(apt, selectedBeds) {
    if (!selectedBeds || selectedBeds === "any") return true;
    if (!apt.bed_numbers || apt.bed_numbers.length === 0) return false;
    if (selectedBeds === "studio") return apt.bed_numbers.includes(0);
    if (selectedBeds === "4+") return apt.bed_numbers.some(n => n >= 4);
    return apt.bed_numbers.includes(Number(selectedBeds));
}

function getActiveBeds() {
    const btn = document.querySelector(".bed-seg .layer-seg-btn.active");
    return btn ? btn.dataset.beds : "any";
}

function normalizeDateString(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    // Use LOCAL date components, not UTC, so events near midnight don't shift days
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function eventMatchesDateRange(event, startDate, endDate) {
    const eventDate = normalizeDateString(event.event_start_date || event.event_date);
    if (!eventDate) return true;
    if (startDate && eventDate < startDate) return false;
    if (endDate && eventDate > endDate) return false;
    return true;
}

function eventMatchesCategory(event, selectedCategory) {
    if (!selectedCategory || selectedCategory === "all") return true;
    if (event.event_type) return event.event_type === selectedCategory;
    const eventCategories = Array.isArray(event.categories) ? event.categories : [];
    return eventCategories.includes(selectedCategory);
}

function collectEventCategories(events) {
    const counts = {};
    events.forEach(ev => {
        const cat = ev.event_type || (Array.isArray(ev.categories) && ev.categories[0]);
        if (cat) counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

function getSelectedEventCategory(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return "all";
    return el.value || "all";
}

function buildEventCategoryFilters(categories, selectId, onSelect) {
    // selectId is the hidden input id — derive btn/list/wrap ids from it
    const suffix = selectId === "eventCategoryFilter" ? "Desktop" : "Mobile";
    const btn    = document.getElementById(`catFilterBtn${suffix}`);
    const list   = document.getElementById(`catFilterList${suffix}`);
    const wrap   = document.getElementById(`catFilterWrap${suffix}`);
    const hidden = document.getElementById(selectId);
    if (!btn || !list || !wrap || !hidden) return;

    // Build list items
    list.innerHTML = "";
    const allItem = document.createElement("li");
    allItem.textContent = "All Categories";
    allItem.dataset.value = "all";
    allItem.classList.add("selected");
    list.appendChild(allItem);

    categories.forEach(cat => {
        const li = document.createElement("li");
        li.textContent = cat;
        li.dataset.value = cat;
        list.appendChild(li);
    });

    // Toggle open/close — scroll filter row into view on mobile when opening
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        wrap.classList.toggle("open");
        if (wrap.classList.contains("open") && window.innerWidth < 768) {
            // Scroll the filter row so the dropdown wrap is visible
            const filterRow = wrap.closest(".mobile-filter-row");
            if (filterRow) {
                const wrapLeft = wrap.offsetLeft;
                filterRow.scrollTo({ left: wrapLeft - 8, behavior: "smooth" });
            }
        }
    });

    // Select item
    list.addEventListener("click", (e) => {
        const li = e.target.closest("li");
        if (!li) return;
        const val = li.dataset.value;
        hidden.value = val === "all" ? "" : val;
        btn.textContent = li.textContent;
        list.querySelectorAll("li").forEach(l => l.classList.toggle("selected", l === li));
        wrap.classList.remove("open");
        if (onSelect) onSelect();
    });

    // Close on outside click
    document.addEventListener("click", () => wrap.classList.remove("open"));
}

function isDefaultTime(isoStr) {
    return !isoStr || isoStr.endsWith("T23:59:59");
}

function formatEventDate(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    const hasTime = !isoStr.endsWith("T23:59:59"); // end-of-day default means no real time
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    const datePart = `${weekday}, ${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
    if (!hasTime) return datePart;
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${datePart} · ${timePart}`;
}

function formatEventTime(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isSameLocalDay(isoA, isoB) {
    if (!isoA || !isoB) return false;
    const a = new Date(isoA), b = new Date(isoB);
    if (isNaN(a) || isNaN(b)) return false;
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function formatEventDateRange(startIso, endIso) {
    if (!startIso) return "";
    const startStr = formatEventDate(startIso);
    if (!endIso || isDefaultTime(endIso)) return startStr;
    if (formatEventDate(endIso) === startStr) return startStr;
    // Same day: show date once, then times
    if (isSameLocalDay(startIso, endIso)) {
        const endTime = formatEventTime(endIso);
        return endTime ? `${startStr} - ${endTime}` : startStr;
    }
    // Different days: full date range
    return `${startStr} - ${formatEventDate(endIso)}`;
}

function isEventInFuture(ev) {
    const isoStr = ev.event_start_date;
    if (!isoStr) return true; // no date info, show it
    const d = new Date(isoStr);
    return isNaN(d) || d > new Date();
}

function groupByCoord(events) {
    const groups = {};
    events.forEach(ev => {
        const key = `${ev.longitude},${ev.latitude}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(ev);
    });
    return groups;
}

function isMobile() {
    return window.innerWidth < 768;
}

function getMobileFlyPadding() {
    if (!isMobile()) return { top: 80, bottom: 40, left: 40, right: 40 };
    const mapEl = document.getElementById("map");
    const mapH = mapEl ? mapEl.getBoundingClientRect().height : window.innerHeight;
    return { top: Math.round(mapH * 0.75), bottom: Math.round(mapH * 0.05), left: 20, right: 20 };
}

// ── Active popup tracker ───────────────────────────────────────────────────────
let activePopup = null;

function openPopup(popup) {
    if (activePopup) activePopup.remove();
    activePopup = popup;
    popup.on("close", () => { activePopup = null; });
    popup.addTo(map);
}

// ── Favorites ──────────────────────────────────────────────────────────────────
const isLoggedIn = window.IS_LOGGED_IN || false;
let favoritedIds = new Set(); // "type:id" strings e.g. "apartment:r4nym93"

function favKey(itemType, itemId) {
    return `${itemType}:${itemId}`;
}

async function fetchFavorites() {
    if (!isLoggedIn) return;
    try {
        const res = await fetch("/api/favorites", { credentials: "include" });
        if (handle503(res)) return;
        if (!res.ok) return;
        const data = await res.json();
        favoritedIds = new Set(data.favorites.map(f => favKey(f.item_type, f.item_id)));
    } catch (e) {
        console.error("Failed to fetch favorites", e);
    }
}

async function toggleFavorite(itemId, itemType) {
    const key = favKey(itemType, itemId);
    const isFav = favoritedIds.has(key);
    try {
        const res = await fetch("/api/favorites", {
            method: isFav ? "DELETE" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_id: String(itemId), item_type: itemType }),
            credentials: "include"
        });
        if (handle503(res)) return;
        if (!res.ok) return;
        isFav ? favoritedIds.delete(key) : favoritedIds.add(key);
        document.querySelectorAll(`.favorite-btn[data-item-id="${itemId}"][data-item-type="${itemType}"]`).forEach(btn => {
            const nowFav = favoritedIds.has(key);
            btn.textContent = nowFav ? "♥ Saved" : "♡ Save";
            btn.classList.toggle("favorited", nowFav);
            btn.title = nowFav ? "Remove from favorites" : "Add to favorites";
        });
    } catch (e) {
        console.error("Failed to toggle favorite", e);
    }
}

function buildFavBtnHTML(itemId, itemType) {
    if (!isLoggedIn || !itemId) return "";
    const isFav = favoritedIds.has(favKey(itemType, itemId));
    const label = isFav ? "♥ Saved" : "♡ Save";
    return `<button class="favorite-btn${isFav ? " favorited" : ""}" data-item-id="${escapeHtml(String(itemId))}" data-item-type="${itemType}" title="${isFav ? "Remove from favorites" : "Add to favorites"}">${label}</button>`;
}

// Event delegation — handles favorite buttons anywhere in the document
document.addEventListener("click", async e => {
    const btn = e.target.closest(".favorite-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    btn.blur(); // release focus before Mapbox can complain
    await toggleFavorite(btn.dataset.itemId, btn.dataset.itemType);
}, true); // capture phase so we intercept before Mapbox

// ── Sidebar ────────────────────────────────────────────────────────────────────
const sidebarList  = document.getElementById("sidebar-list");
const sidebarTitle = document.getElementById("sidebar-title");
const sidebarCount = document.getElementById("sidebar-count");
const sidebar      = document.getElementById("sidebar");
const toggleBtn    = document.getElementById("sidebar-toggle");

// Sidebar starts collapsed on mobile (class baked into HTML).
// On desktop, remove the collapsed class so it starts expanded.
if (!isMobile()) {
    sidebar.classList.remove("collapsed");
}
if (isMobile()) {
    toggleBtn.textContent = "▲ Show List";
}

// Desktop: only the toggle button collapses/expands
// Mobile: the whole header is tappable
function doToggle() {
    const isCollapsed = sidebar.classList.contains("collapsed");
    sidebar.classList.toggle("collapsed");
    if (isMobile() && isCollapsed && activePopup) {
        activePopup.remove();
    }
    if (isMobile()) {
        toggleBtn.textContent = sidebar.classList.contains("collapsed") ? "▲ Show List" : "▼ Show Map";
    }
    setTimeout(() => map.resize(), 360);
}

toggleBtn.addEventListener("click", doToggle);

document.getElementById("sidebar-header").addEventListener("click", () => {
    if (isMobile()) doToggle();
});

function collapseOnMobile() {
    if (isMobile() && !sidebar.classList.contains("collapsed")) {
        sidebar.classList.add("collapsed");
        toggleBtn.textContent = "▲ Show List";
        setTimeout(() => map.resize(), 360);
    }
}



function buildAptSidebarCard(apt) {
    const title   = decodeHtml(apt.title || apt.address || "Apartment");
    const address = apt.address || "Unknown address";
    const phone   = apt.phone_number || null;
    const link    = apt.link || null;
    const rent    = apt.rent_by_bed;
    const mobile  = isMobile();

    // Badges: desktop shows phone too, mobile skips it
    let badges = `<div class="badges"><span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    if (!mobile && phone) badges += `<span class="badge-item">${phoneIcon} ${escapeHtml(phone)}</span>`;
    badges += `</div>`;

    let rentBlock = "";
    if (rent && Object.keys(rent).length > 0) {
        if (mobile) {
            // Mobile: single inline line
            const parts = Object.entries(rent).map(([bed, price]) => `${escapeHtml(bed)}: ${escapeHtml(price)}`);
            rentBlock = `<div class="rent-block"><strong>Rent:</strong> ${parts.join(" &nbsp;|&nbsp; ")}</div>`;
        } else {
            // Desktop: bullet list
            rentBlock = `<div class="rent-block"><strong>Rent</strong><ul>`;
            for (const [bed, price] of Object.entries(rent))
                rentBlock += `<li>${escapeHtml(bed)} — ${escapeHtml(price)}</li>`;
            rentBlock += `</ul></div>`;
        }
    } else {
        rentBlock = `<div class="rent-block"><strong>Rent:</strong> N/A</div>`;
    }

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View Apartment</a>` : "";

    const favBtn = buildFavBtnHTML(apt.listing_id, "apartment");
    const footer = `<div class="card-footer-row">${cta}${favBtn}</div>`;

    const card = document.createElement("div");
    card.className = "sidebar-card";
    card.dataset.lat = apt.lat;
    card.dataset.lon = apt.lon;
    card.innerHTML = `<h3>${escapeHtml(title)}</h3>${badges}${rentBlock}${footer}`;
    return card;
}

function buildEventSidebarCard(ev) {
    const title      = decodeHtml(ev.event_title || "Event");
    const address    = ev.address     || "";
    const rawEnd = ev.event_end_date;
    const dateStr = formatEventDateRange(ev.event_start_date, rawEnd) || ev.event_date || "";
    const desc       = decodeHtml(ev.description || "");
    const link       = ev.event_detail_url || null;

    let recurrenceInfo = "";
    if (ev.is_recurring) {
        recurrenceInfo = ev.recurrence_description || "Recurring event";
        const recurrenceEnd = normalizeDateString(ev.recurrence_end_date);
        if (recurrenceEnd) recurrenceInfo += ` until ${recurrenceEnd}`;
    }

    let badges = `<div class="badges">`;
    if (dateStr) badges += `<span class="badge-item">${calIcon} ${escapeHtml(dateStr)}</span>`;
    if (recurrenceInfo) badges += `<span class="badge-item">↻ ${escapeHtml(recurrenceInfo)}</span>`;
    if (address) badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    badges += `</div>`;

    const descBlock = desc
        ? `<p class="evt-desc">${escapeHtml(desc.length > 100 ? desc.slice(0, 100) + "…" : desc)}</p>`
        : "";

    const cta = link ? `<a class="cta cta-event" href="${escapeHtml(link)}" target="_blank">View Event</a>` : "";

    const favBtn = buildFavBtnHTML(ev.id, "event");
    const footer = `<div class="card-footer-row">${cta}${favBtn}</div>`;

    const card = document.createElement("div");
    card.className = "sidebar-card";
    card.dataset.lat = ev.latitude;
    card.dataset.lon = ev.longitude;
    card.innerHTML = `<h3>${escapeHtml(title)}</h3>${badges}${descBlock}${footer}`;
    return card;
}

function populateSidebarApartments(apartments, maxPrice, minPrice = 0, beds = "any") {
    sidebarTitle.innerHTML = "<span class='dot dot-apt'></span> Apartments";
    sidebarList.innerHTML = "";

    const filtered = apartments
        .filter(apt => apt.lat && apt.lon)
        .filter(hasReadablePrice)
        .filter(apt => { const p = getApartmentMinPrice(apt); return p >= minPrice && p <= maxPrice; })
        .filter(apt => aptMatchesBeds(apt, beds));

    sidebarCount.textContent = `${filtered.length} listing${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
        sidebarList.innerHTML = `<div class="sidebar-empty">No apartments match the current filters.</div>`;
        return;
    }

    filtered.forEach(apt => {
        const card = buildAptSidebarCard(apt);
        card.addEventListener("click", (e) => {
            if (e.target.closest(".favorite-btn")) return;
            document.querySelectorAll(".sidebar-card").forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            map.flyTo({ center: [apt.lon, apt.lat], zoom: 15, duration: 600, padding: getMobileFlyPadding() });
            const popup = new mapboxgl.Popup({ offset: 12, anchor: 'bottom', maxWidth: isMobile() ? (window.innerWidth - 32) + "px" : "320px" })
                .setLngLat([apt.lon, apt.lat])
                .setHTML(buildAptPopupHTML(apt));
            openPopup(popup);
            collapseOnMobile();
        });
        sidebarList.appendChild(card);
    });
}

function populateSidebarEvents(events) {
    sidebarTitle.innerHTML = "<span class='dot dot-evt'></span> Events";
    sidebarList.innerHTML = "";

    const filtered = events.filter(ev => ev.latitude != null && ev.longitude != null);
    sidebarCount.textContent = `${filtered.length} event${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
        sidebarList.innerHTML = `<div class="sidebar-empty">No events match the current filters.</div>`;
        return;
    }

    filtered.forEach(ev => {
        const card = buildEventSidebarCard(ev);
        card.addEventListener("click", (e) => {
            if (e.target.closest(".favorite-btn")) return;
            document.querySelectorAll(".sidebar-card").forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            map.flyTo({ center: [ev.longitude, ev.latitude], zoom: 15, duration: 600, padding: getMobileFlyPadding() });
            const eventsAtLocation = eventGroups[`${ev.longitude},${ev.latitude}`] || [ev];
            const popup = new mapboxgl.Popup({ offset: 12, anchor: 'bottom', maxWidth: isMobile() ? (window.innerWidth - 32) + "px" : "380px" })
                .setLngLat([ev.longitude, ev.latitude])
                .setDOMContent(buildEventCarouselNode(eventsAtLocation));
            openPopup(popup);
            collapseOnMobile();
        });
        sidebarList.appendChild(card);
    });
}

// ── Popup builders ─────────────────────────────────────────────────────────────
function buildAptPopupHTML(apt) {
    const title   = apt.title || apt.address || "Apartment";
    const address = apt.address || "Unknown address";
    const phone   = apt.phone_number || null;
    const link    = apt.link || null;
    const rent    = apt.rent_by_bed;

    let badges = `<div class="badges">`;
    badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    if (phone) badges += `<span class="badge-item">${phoneIcon} ${escapeHtml(phone)}</span>`;
    badges += `</div>`;

    let rentBlock = "";
    if (rent && Object.keys(rent).length > 0) {
        rentBlock = `<div class="rent-block"><strong>Rent</strong><ul>`;
        for (const [bed, price] of Object.entries(rent))
            rentBlock += `<li>${escapeHtml(bed)} — ${escapeHtml(price)}</li>`;
        rentBlock += `</ul></div>`;
    } else {
        rentBlock = `<div class="rent-block"><strong>Rent:</strong> N/A</div>`;
    }

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View Apartment</a>` : "";
    const favBtn = buildFavBtnHTML(apt.listing_id, "apartment");
    const footer = `<div class="card-footer-row">${cta}${favBtn}</div>`;

    return `<div class="apt-popup"><h3>${escapeHtml(title)}</h3>${badges}${rentBlock}${footer}</div>`;
}

function buildEventCardHTML(event) {
    const title   = decodeHtml(event.event_title || "Event");
    const address = event.address     || "";
    const rawEndEvt = event.event_end_date;
    const dateStr = formatEventDateRange(event.event_start_date, rawEndEvt) || event.event_date || "";
    const desc    = decodeHtml(event.description || "");
    const link    = event.event_detail_url || null;

    let recurrenceInfo = "";
    if (event.is_recurring) {
        recurrenceInfo = event.recurrence_description || "Recurring event";
        const recurrenceEnd = normalizeDateString(event.recurrence_end_date);
        if (recurrenceEnd) recurrenceInfo += ` until ${recurrenceEnd}`;
    }

    let badges = `<div class="badges">`;
    if (dateStr) badges += `<span class="badge-item">${calIcon} ${escapeHtml(dateStr)}</span>`;
    if (recurrenceInfo) badges += `<span class="badge-item">↻ ${escapeHtml(recurrenceInfo)}</span>`;
    if (address) badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    badges += `</div>`;

    const descBlock = desc
        ? `<p class="evt-desc">${escapeHtml(desc.length > 120 ? desc.slice(0, 120) + "…" : desc)}</p>`
        : "";

    const cta = link ? `<a class="cta cta-event" href="${escapeHtml(link)}" target="_blank">View Event</a>` : "";
    const favBtn = buildFavBtnHTML(event.id, "event");
    const footer = `<div class="card-footer-row">${cta}${favBtn}</div>`;

    return `<div><h3>${escapeHtml(title)}</h3>${badges}${descBlock}${footer}</div>`;
}

// ── GeoJSON builders ───────────────────────────────────────────────────────────
function buildApartmentGeoJSON(apartments, maxPrice, minPrice = 0, beds = "any") {
    return {
        type: "FeatureCollection",
        features: apartments
            .filter(apt => apt.lat && apt.lon)
            .filter(hasReadablePrice)
            .filter(apt => { const p = getApartmentMinPrice(apt); return p >= minPrice && p <= maxPrice; })
            .filter(apt => aptMatchesBeds(apt, beds))
            .map(apt => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [apt.lon, apt.lat] },
                properties: {
                    apt_id: apt.listing_id || null,
                    title: apt.title || apt.address || "Apartment"
                }
            }))
    };
}

function buildEventGeoJSON(events) {
    const grouped = groupByCoord(events);
    return {
        type: "FeatureCollection",
        features: Object.entries(grouped).map(([key, evs]) => {
            const [lng, lat] = key.split(",").map(Number);
            return {
                type: "Feature",
                geometry: { type: "Point", coordinates: [lng, lat] },
                properties: { coordKey: key, count: evs.length, title: evs[0].event_title || "Event" }
            };
        })
    };
}

// ── Carousel popup ─────────────────────────────────────────────────────────────
function buildEventCarouselNode(events) {
    let index = 0;
    const wrapper = document.createElement("div");
    wrapper.className = "apt-popup popup-carousel";

    const content = document.createElement("div");
    wrapper.appendChild(content);

    let prevBtn, nextBtn, counter;
    if (events.length > 1) {
        const nav = document.createElement("div");
        nav.className = "carousel-nav";
        prevBtn = document.createElement("button");
        prevBtn.textContent = "←";
        counter = document.createElement("span");
        counter.className = "carousel-counter";
        nextBtn = document.createElement("button");
        nextBtn.textContent = "→";
        nav.appendChild(prevBtn);
        nav.appendChild(counter);
        nav.appendChild(nextBtn);
        wrapper.appendChild(nav);
        prevBtn.addEventListener("click", () => { if (index > 0) { index--; render(); } });
        nextBtn.addEventListener("click", () => { if (index < events.length - 1) { index++; render(); } });
    }

    function render() {
        content.innerHTML = buildEventCardHTML(events[index]);
        if (events.length > 1) {
            counter.textContent = `${index + 1} / ${events.length}`;
            prevBtn.disabled = index === 0;
            nextBtn.disabled = index === events.length - 1;
        }
    }

    render();
    return wrapper;
}

// ── Layer helpers ──────────────────────────────────────────────────────────────
function setLayerGroupVisibility(prefix, visible) {
    const v = visible ? "visible" : "none";
    [`${prefix}-clusters`, `${prefix}-cluster-count`, `${prefix}-unclustered-point`]
        .forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v); });
}

function addClusteredLayer(prefix, geojson, color, darkColor, veryDarkColor) {
    map.addSource(prefix, { type: "geojson", data: geojson, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });

    map.addLayer({
        id: `${prefix}-clusters`, type: "circle", source: prefix,
        filter: ["has", "point_count"],
        paint: {
            "circle-color": ["step", ["get", "point_count"], color, 10, darkColor, 30, veryDarkColor],
            "circle-radius": ["step", ["get", "point_count"], 20, 10, 28, 30, 36],
            "circle-opacity": 0.85,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff"
        }
    });

    map.addLayer({
        id: `${prefix}-cluster-count`, type: "symbol", source: prefix,
        filter: ["has", "point_count"],
        layout: {
            "text-field": "{point_count_abbreviated}",
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 14
        },
        paint: { "text-color": "#ffffff" }
    });

    map.addLayer({
        id: `${prefix}-unclustered-point`, type: "circle", source: prefix,
        filter: ["!", ["has", "point_count"]],
        paint: {
            "circle-radius": 8,
            "circle-color": color,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff"
        }
    });

    map.on("click", `${prefix}-clusters`, e => {
        const features = map.queryRenderedFeatures(e.point, { layers: [`${prefix}-clusters`] });
        const clusterId = features[0].properties.cluster_id;
        map.getSource(prefix).getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (!err) map.easeTo({ center: features[0].geometry.coordinates, zoom });
        });
    });

    map.on("mouseenter", `${prefix}-clusters`,          () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", `${prefix}-clusters`,          () => map.getCanvas().style.cursor = "");
    map.on("mouseenter", `${prefix}-unclustered-point`, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", `${prefix}-unclustered-point`, () => map.getCanvas().style.cursor = "");
}

// ── Pin size for mobile ────────────────────────────────────────────────────────
function updatePinSize() {
    const radius = isMobile() ? 14 : 8;
    ["apartments-unclustered-point", "events-unclustered-point"].forEach(id => {
        if (map.getLayer(id)) map.setPaintProperty(id, "circle-radius", radius);
    });
}

function updateSidebarMaxHeight() {
    const topbar = document.getElementById("topbar");
    const filtersWrap = document.getElementById("filters-wrap");
    let topbarH = 0;
    if (isMobile() && topbar) {
        topbarH = topbar.getBoundingClientRect().height;
        // Add filter overlay height when expanded
        if (filtersWrap && !topbar.classList.contains("filters-collapsed")) {
            topbarH += filtersWrap.getBoundingClientRect().height;
        }
    }
    const navbarH = 56;
    document.documentElement.style.setProperty(
        "--sidebar-max-height",
        `calc(100vh - ${navbarH}px - ${topbarH}px)`
    );
}

let wasMobile = isMobile();
window.addEventListener("resize", () => {
    updatePinSize();
    updateSidebarMaxHeight();
    const nowMobile = isMobile();
    if (nowMobile !== wasMobile) {
        wasMobile = nowMobile;
        window.dispatchEvent(new Event("breakpointchange"));
    }
});

// ── Main ───────────────────────────────────────────────────────────────────────
let eventGroups = {};

map.on("load", () => {
    Promise.all([
        fetch("/data/apartments").then(r => r.json()),
        fetch("/data/events").then(r => r.json())
    ]).then(([apartments, events]) => {

        // ── DOM refs ────────────────────────────────────────────────────────
        const priceRange         = document.getElementById("priceRange");
        const priceRangeMobile   = document.getElementById("priceRangeMobile");
        const aptFiltersDesktop  = document.getElementById("apt-filters-desktop");
        const evtFiltersDesktop  = document.getElementById("evt-filters-desktop");
        const aptFiltersMobile   = document.getElementById("apt-filters-mobile");
        const evtFiltersMobile   = document.getElementById("evt-filters-mobile");
        const eventStartDate     = document.getElementById("eventStartDate");
        const eventEndDate       = document.getElementById("eventEndDate");
        const eventStartDateMob  = document.getElementById("eventStartDateMobile");
        const eventEndDateMob    = document.getElementById("eventEndDateMobile");

        // ── Calculate dynamic price range from data ─────────────────────────
        const pricedApartments = apartments.filter(hasReadablePrice);
        const allPrices = pricedApartments.map(getApartmentMinPrice).filter(v => v !== null);
        const minRent = allPrices.length > 0 ? Math.floor(Math.min(...allPrices) / 50) * 50 : 500;
        const maxRent = allPrices.length > 0 ? Math.ceil(Math.max(...allPrices) / 50) * 50 : 4000;

        [priceRange, priceRangeMobile].forEach(el => {
            el.min = minRent; el.max = maxRent; el.step = 50; el.value = maxRent;
        });
        // Set min sliders
        [document.getElementById("priceMin"), document.getElementById("priceMinMobile")].forEach(el => {
            if (el) { el.min = minRent; el.max = maxRent; el.step = 50; el.value = minRent; }
        });

        // ── Sync desktop & mobile price sliders ─────────────────────────────
        const priceValueDisplay    = document.getElementById("priceValueDisplay");
        const priceMinDisplayMobile = document.getElementById("priceMinDisplayMobile");
        const priceMinEl         = document.getElementById("priceMin");
        const priceMinMobileEl   = document.getElementById("priceMinMobile");
        const priceMinDisplay    = document.getElementById("priceMinDisplay");
        const priceMaxDisplay    = document.getElementById("priceMaxDisplay");
        const priceRangeFill     = document.getElementById("priceRangeFill");
        const priceRangeFillMob  = document.getElementById("priceRangeFillMobile");
        const MIN_GAP = 100;

        let currentMin = minRent;
        let currentMax = maxRent;

        function updateFill(fillEl, minVal, maxVal, sliderMin, sliderMax) {
            if (!fillEl) return;
            const pctMin = (minVal - sliderMin) / (sliderMax - sliderMin) * 100;
            const pctMax = (maxVal - sliderMin) / (sliderMax - sliderMin) * 100;
            fillEl.style.left  = pctMin + "%";
            fillEl.style.width = (pctMax - pctMin) + "%";
        }

        function syncPrice(newMin, newMax) {
            // Enforce min gap
            if (newMax - newMin < MIN_GAP) {
                if (newMin !== currentMin) newMax = newMin + MIN_GAP;
                else newMin = newMax - MIN_GAP;
            }
            newMin = Math.max(minRent, newMin);
            newMax = Math.min(maxRent, newMax);
            currentMin = newMin;
            currentMax = newMax;

            // Sync all sliders
            [priceMinEl, priceMinMobileEl].forEach(el => { if (el) el.value = newMin; });
            [priceRange, priceRangeMobile].forEach(el => { if (el) el.value = newMax; });

            // Update labels
            if (priceMinDisplay) priceMinDisplay.textContent = `$${newMin.toLocaleString()}`;
            if (priceMaxDisplay) priceMaxDisplay.textContent = `$${newMax.toLocaleString()}`;
            if (priceValueDisplay) priceValueDisplay.textContent = `$${newMax.toLocaleString()}`;
            if (priceMinDisplayMobile) priceMinDisplayMobile.textContent = `$${newMin.toLocaleString()}`;

            // Update fill tracks
            updateFill(priceRangeFill,    newMin, newMax, minRent, maxRent);
            updateFill(priceRangeFillMob, newMin, newMax, minRent, maxRent);

            const beds = getActiveBeds();
            map.getSource("apartments").setData(buildApartmentGeoJSON(apartments, newMax, newMin, beds));
            populateSidebarApartments(apartments, newMax, newMin, beds);
        }

        if (priceMinEl) priceMinEl.addEventListener("input", () =>
            syncPrice(Number(priceMinEl.value), currentMax));
        if (priceMinMobileEl) priceMinMobileEl.addEventListener("input", () =>
            syncPrice(Number(priceMinMobileEl.value), currentMax));
        priceRange.addEventListener("input", () =>
            syncPrice(currentMin, Number(priceRange.value)));
        priceRangeMobile.addEventListener("input", () =>
            syncPrice(currentMin, Number(priceRangeMobile.value)));

        // ── Apartments layer ─────────────────────────────────────────────────
        // Build lookup so map pin clicks can generate fresh popups with correct fav state
        const aptById = {};
        apartments.forEach(apt => { if (apt.listing_id) aptById[apt.listing_id] = apt; });

        addClusteredLayer("apartments", buildApartmentGeoJSON(apartments, maxRent, minRent, getActiveBeds()), "#5a7a5c", "#4a6a4c", "#3a5a3c");
        populateSidebarApartments(apartments, maxRent, minRent, getActiveBeds());
        // Draw initial fill
        syncPrice(minRent, maxRent);

        map.on("click", "apartments-unclustered-point", e => {
            const coords = e.features[0].geometry.coordinates.slice();
            const aptId = e.features[0].properties.apt_id;
            const apt = aptId && aptById[aptId];
            while (Math.abs(e.lngLat.lng - coords[0]) > 180)
                coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
            const aptPopup = new mapboxgl.Popup({ offset: 12, anchor: 'bottom', maxWidth: isMobile() ? (window.innerWidth - 32) + "px" : "320px" })
                .setLngLat(coords)
                .setHTML(apt ? buildAptPopupHTML(apt) : "<div class='apt-popup'><h3>Apartment</h3></div>");
            if (isMobile()) {
                map.once("moveend", () => openPopup(aptPopup));
                map.flyTo({ center: coords, zoom: map.getZoom(), padding: { top: 400, bottom: 20, left: 20, right: 20 }, duration: 400 });
            } else {
                openPopup(aptPopup);
            }
        });

        // ── Event categories ─────────────────────────────────────────────────
        const allCategories = collectEventCategories(events);
        buildEventCategoryFilters(allCategories, "eventCategoryFilter", updateEventLayer);
        buildEventCategoryFilters(allCategories, "eventCategoryFilterMobile", updateEventLayer);

        // ── Events layer ─────────────────────────────────────────────────────
        function getActiveEventFilters() {
            const mobile = isMobile();
            return {
                startDate: (mobile ? eventStartDateMob : eventStartDate).value || null,
                endDate:   (mobile ? eventEndDateMob   : eventEndDate).value   || null,
                category:  getSelectedEventCategory(mobile ? "eventCategoryFilterMobile" : "eventCategoryFilter")
            };
        }

        function getActiveLayer() {
            const active = document.querySelector(".layer-seg-btn[data-layer].active");
            return active ? active.dataset.layer : "apartments";
        }

        function updateEventLayer() {
            const { startDate, endDate, category } = getActiveEventFilters();
            const filteredEvents = events.filter(ev => {
                if (ev.latitude == null || ev.longitude == null) return false;
                if (!isEventInFuture(ev)) return false;
                if (!eventMatchesDateRange(ev, startDate, endDate)) return false;
                if (!eventMatchesCategory(ev, category)) return false;
                return true;
            });
            eventGroups = groupByCoord(filteredEvents);
            map.getSource("events").setData(buildEventGeoJSON(filteredEvents));
            populateSidebarEvents(filteredEvents);
        }

        // ── Calendar date range picker ──────────────────────────────────────────
        function setupCalendarPicker(btnId, popupId, clearId, applyId, startId, endId, gridId, monthLabelId, prevId, nextId, selectionId) {
            const btn       = document.getElementById(btnId);
            const popup     = document.getElementById(popupId);
            const clearBtn  = document.getElementById(clearId);
            const applyBtn  = document.getElementById(applyId);
            const startEl   = document.getElementById(startId);
            const endEl     = document.getElementById(endId);
            const grid      = document.getElementById(gridId);
            const monthLabel= document.getElementById(monthLabelId);
            const prevBtn   = document.getElementById(prevId);
            const nextBtn   = document.getElementById(nextId);
            const selection = document.getElementById(selectionId);

            const today   = new Date(); today.setHours(0,0,0,0);
            const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + 30);

            let viewYear  = today.getFullYear();
            let viewMonth = today.getMonth();
            let startDate = null;
            let endDate   = null;
            let selecting = "start"; // "start" or "end"

            function toYMD(d) {
                return d.toISOString().split("T")[0];
            }

            function fromYMD(s) {
                if (!s) return null;
                const [y,m,d] = s.split("-").map(Number);
                return new Date(y, m-1, d);
            }

            function updateBtnLabel() {
                const s = startEl.value, e = endEl.value;
                if (!s && !e) {
                    btn.textContent = "📅 All Dates";
                    btn.classList.remove("active");
                } else {
                    const fmt = d => {
                        const dt = fromYMD(d);
                        return `${dt.getMonth() + 1}/${String(dt.getDate()).padStart(2, "0")}`;
                    };
                    btn.textContent = s && e ? `📅 ${fmt(s)} – ${fmt(e)}` : s ? `📅 From ${fmt(s)}` : `📅 Until ${fmt(e)}`;
                    btn.classList.add("active");
                }
            }

            function renderCalendar() {
                const firstDay = new Date(viewYear, viewMonth, 1).getDay();
                const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
                const monthName = new Date(viewYear, viewMonth).toLocaleString("en-US", { month:"long", year:"numeric" });
                monthLabel.textContent = monthName;

                // Disable prev if current month is today's month
                const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                const viewingMonth = new Date(viewYear, viewMonth, 1);
                prevBtn.disabled = viewingMonth <= todayMonth;

                // Disable next if we'd go past maxDate's month
                const maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
                nextBtn.disabled = viewingMonth >= maxMonth;

                grid.innerHTML = "";

                // Empty cells before first day
                for (let i = 0; i < firstDay; i++) {
                    const empty = document.createElement("div");
                    empty.className = "cal-day cal-day-empty";
                    grid.appendChild(empty);
                }

                for (let d = 1; d <= daysInMonth; d++) {
                    const date = new Date(viewYear, viewMonth, d);
                    const cell = document.createElement("div");
                    cell.textContent = d;
                    cell.className = "cal-day";

                    const disabled = date < today || date > maxDate;
                    const isToday  = toYMD(date) === toYMD(today);
                    const isStart  = startDate && toYMD(date) === toYMD(startDate);
                    const isEnd    = endDate   && toYMD(date) === toYMD(endDate);
                    const inRange  = startDate && endDate && date > startDate && date < endDate;

                    if (disabled) { cell.classList.add("cal-day-disabled"); }
                    if (isToday)  { cell.classList.add("cal-day-today"); }
                    if (isStart)  { cell.classList.add("cal-day-start"); }
                    if (isEnd)    { cell.classList.add("cal-day-end"); }
                    if (inRange)  { cell.classList.add("cal-day-in-range"); }

                    if (!disabled) {
                        cell.addEventListener("click", (e) => { e.stopPropagation(); handleDayClick(date); });
                    }

                    grid.appendChild(cell);
                }

                // Update selection hint
                if (!startDate && !endDate) {
                    selection.textContent = "Select start date";
                } else if (startDate && !endDate) {
                    selection.textContent = `Start: ${startDate.toLocaleDateString("en-US", {month:"short",day:"numeric"})} — select end date`;
                } else {
                    selection.textContent = `${startDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${endDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
                }
            }

            function handleDayClick(date) {
                if (selecting === "start") {
                    startDate = date;
                    endDate = null;
                    startEl.value = toYMD(date);
                    endEl.value = "";
                    selecting = "end";
                } else {
                    if (date < startDate) {
                        // Clicked before start — reset and use as new start
                        startDate = date;
                        endDate = null;
                        startEl.value = toYMD(date);
                        endEl.value = "";
                    } else {
                        endDate = date;
                        endEl.value = toYMD(date);
                        selecting = "start";
                    }
                }
                renderCalendar();
            }

            prevBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                viewMonth--;
                if (viewMonth < 0) { viewMonth = 11; viewYear--; }
                renderCalendar();
            });

            nextBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                viewMonth++;
                if (viewMonth > 11) { viewMonth = 0; viewYear++; }
                renderCalendar();
            });

            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                popup.classList.toggle("open");
                if (popup.classList.contains("open")) {
                    renderCalendar();
                    if (window.innerWidth < 768) {
                        const topbar = document.getElementById("topbar");
                        const filtersWrap = document.getElementById("filters-wrap");
                        const useFilters = filtersWrap && topbar && !topbar.classList.contains("filters-collapsed");
                        const anchor = useFilters ? filtersWrap : topbar;
                        const anchorBottom = anchor.getBoundingClientRect().bottom;

                        const vw = window.innerWidth;
                        const vh = window.innerHeight;
                        // Width: fits screen with margin, capped by viewport height ratio
                        const maxWidth = Math.min(vw - 16, Math.round(vh * 0.55));
                        // Height: never exceeds remaining viewport space below the popup top
                        const popupTop = anchorBottom - 100;
                        const maxHeight = vh - popupTop - 16;

                        popup.style.top = popupTop + "px";
                        popup.style.left = "50%";
                        popup.style.right = "auto";
                        popup.style.transform = "translateX(-50%)";
                        popup.style.width = maxWidth + "px";
                        popup.style.maxHeight = maxHeight + "px";
                        popup.style.overflowY = "auto";
                    }
                }
            });

            clearBtn.addEventListener("click", (e) => { e.stopPropagation();
                startDate = null; endDate = null; selecting = "start";
                startEl.value = ""; endEl.value = "";
                updateBtnLabel();
                popup.classList.remove("open");
                updateEventLayer();
            });

            applyBtn.addEventListener("click", (e) => { e.stopPropagation();
                updateBtnLabel();
                popup.classList.remove("open");
                updateEventLayer();
            });

            document.addEventListener("click", (e) => {
                if (!popup.contains(e.target) && e.target !== btn) {
                    popup.classList.remove("open");
                }
            });
        }

        setupCalendarPicker(
            "dateRangeBtnDesktop", "datePickerDesktop", "dateClearDesktop", "dateApplyDesktop",
            "eventStartDate", "eventEndDate",
            "calGridDesktop", "calMonthDesktop", "calPrevDesktop", "calNextDesktop", "calSelectionDesktop"
        );
        setupCalendarPicker(
            "dateRangeBtnMobile", "datePickerMobile", "dateClearMobile", "dateApplyMobile",
            "eventStartDateMobile", "eventEndDateMobile",
            "calGridMobile", "calMonthMobile", "calPrevMobile", "calNextMobile", "calSelectionMobile"
        );

        // Category filter changes handled inside buildEventCategoryFilters

        const initialFilteredEvents = events.filter(ev => ev.latitude != null && ev.longitude != null && isEventInFuture(ev));
        eventGroups = groupByCoord(initialFilteredEvents);
        addClusteredLayer("events", buildEventGeoJSON(initialFilteredEvents), "#b5546a", "#9a4459", "#7d3347");
        setLayerGroupVisibility("events", false);
        updatePinSize();

        map.on("click", "events-unclustered-point", e => {
            const coords = e.features[0].geometry.coordinates.slice();
            const { coordKey } = e.features[0].properties;
            while (Math.abs(e.lngLat.lng - coords[0]) > 180)
                coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
            const eventsAtLocation = eventGroups[coordKey] || [];
            const evtPopup = new mapboxgl.Popup({ offset: 12, anchor: 'bottom', maxWidth: isMobile() ? (window.innerWidth - 32) + "px" : "380px" })
                .setLngLat(coords).setDOMContent(buildEventCarouselNode(eventsAtLocation));
            if (isMobile()) {
                map.once("moveend", () => openPopup(evtPopup));
                map.flyTo({ center: coords, zoom: map.getZoom(), padding: { top: 400, bottom: 20, left: 20, right: 20 }, duration: 400 });
            } else {
                openPopup(evtPopup);
            }
        });

        // ── Layer toggle (shared radio buttons across desktop + mobile) ──────
        function updateVisibleLayer(selectedLayer) {
            const showApts = selectedLayer === "apartments";

            setLayerGroupVisibility("apartments", showApts);
            setLayerGroupVisibility("events",    !showApts);

            // Desktop filter panels
            aptFiltersDesktop.classList.toggle("d-none",  !showApts);
            aptFiltersDesktop.classList.toggle("d-flex",   showApts);
            evtFiltersDesktop.classList.toggle("d-none",   showApts);
            evtFiltersDesktop.classList.toggle("d-flex",  !showApts);

            // Mobile filter panels
            aptFiltersMobile.classList.toggle("d-none",  !showApts);
            aptFiltersMobile.classList.toggle("d-flex",   showApts);
            evtFiltersMobile.classList.toggle("d-none",   showApts);
            evtFiltersMobile.classList.toggle("d-flex",  !showApts);

            // Recalculate sidebar height since topbar height may change
            setTimeout(updateSidebarMaxHeight, 50);

            if (showApts) {
                populateSidebarApartments(apartments, currentMax, currentMin);
            } else {
                updateEventLayer();
            }
        }

        // Close any open popup when switching layers
        document.querySelectorAll(".layer-seg-btn[data-layer]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (activePopup) { activePopup.remove(); activePopup = null; }
            });
        }, true);

        // Mobile filter toggle
        const filterToggleBtn = document.getElementById("filterToggleBtn");
        const topbar = document.getElementById("topbar");
        if (filterToggleBtn && topbar) {
            filterToggleBtn.addEventListener("click", () => {
                topbar.classList.toggle("filters-collapsed");
                // Resize sidebar to account for the filter overlay
                setTimeout(updateSidebarMaxHeight, 50);
                setTimeout(updateSidebarMaxHeight, 320);
            });
        }

        // Bed filter buttons
        document.querySelectorAll(".bed-seg .layer-seg-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                // Sync both desktop and mobile bed filters
                document.querySelectorAll(".bed-seg .layer-seg-btn").forEach(b =>
                    b.classList.toggle("active", b.dataset.beds === btn.dataset.beds)
                );
                const beds = btn.dataset.beds;
                map.getSource("apartments").setData(buildApartmentGeoJSON(apartments, currentMax, currentMin, beds));
                populateSidebarApartments(apartments, currentMax, currentMin, beds);
            });
        });

        // All layer toggle buttons (desktop + mobile both use .layer-seg-btn)
        const sidebarToggleBtn = document.getElementById("sidebar-toggle");
        function updateSidebarToggleColor(layer) {
            if (sidebarToggleBtn) {
                sidebarToggleBtn.classList.toggle("apt-active", layer === "apartments");
                sidebarToggleBtn.classList.toggle("evt-active", layer === "events");
            }
            sidebar.classList.toggle("evt-active", layer === "events");
        }

        document.querySelectorAll(".layer-seg-btn[data-layer]").forEach(btn => {
            btn.addEventListener("click", () => {
                const layer = btn.dataset.layer;
                document.querySelectorAll(".layer-seg-btn[data-layer]").forEach(b =>
                    b.classList.toggle("active", b.dataset.layer === layer)
                );
                updateSidebarToggleColor(layer);
                updateVisibleLayer(layer);
            });
        });
        updateSidebarToggleColor("apartments");

        // Fetch favorites then rebuild cards so heart state is correct from the start
        updateSidebarMaxHeight();

        // On mobile, play a peek animation to draw attention to the sidebar
        if (isMobile()) {
            setTimeout(() => {
                sidebar.classList.add("peek");
                sidebar.addEventListener("animationend", () => {
                    sidebar.classList.remove("peek");
                }, { once: true });
            }, 800);
        }

        fetchFavorites().then(() => {
            // Rebuild cards with correct fav state but don't override
            // whatever layer the user may have already switched to
            updateVisibleLayer(getActiveLayer());
            if (isMobile()) {
                map.resize();
            }
        });

        // Rebuild cards when crossing mobile/desktop breakpoint
        window.addEventListener("breakpointchange", () => {
            const currentLayer = getActiveLayer();
            if (currentLayer === "apartments") {
                populateSidebarApartments(apartments, currentMax, currentMin);
            } else {
                updateEventLayer();
            }
        });
    });
});