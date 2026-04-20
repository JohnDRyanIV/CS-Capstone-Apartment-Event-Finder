mapboxgl.accessToken = window.MAPBOX_TOKEN;

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

function normalizeDateString(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
}

function eventMatchesDateRange(event, startDate, endDate) {
    const eventDate = normalizeDateString(event.event_date);
    if (!eventDate) return true;
    if (startDate && eventDate < startDate) return false;
    if (endDate && eventDate > endDate) return false;
    return true;
}

function eventMatchesCategories(event, selectedCategories) {
    if (selectedCategories.length === 0) return true;
    const eventCategories = Array.isArray(event.categories) ? event.categories : [];
    return selectedCategories.some(cat => eventCategories.includes(cat));
}

function collectEventCategories(events) {
    const categorySet = new Set();
    events.forEach(ev => {
        if (Array.isArray(ev.categories)) ev.categories.forEach(c => { if (c) categorySet.add(c); });
    });
    return Array.from(categorySet).sort((a, b) => a.localeCompare(b));
}

function getSelectedEventCategories(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map(i => i.value);
}

function buildEventCategoryFilters(categories, containerId, horizontal = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    categories.forEach(cat => {
        const div = document.createElement("div");
        div.className = horizontal ? "form-check form-check-inline mb-0" : "form-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "form-check-input";
        input.value = cat;
        input.id = `${containerId}-${cat.replace(/\s+/g, "-")}`;
        const label = document.createElement("label");
        label.className = "form-check-label";
        label.htmlFor = input.id;
        label.textContent = cat;
        div.appendChild(input);
        div.appendChild(label);
        container.appendChild(div);
    });
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

// ── Sidebar ────────────────────────────────────────────────────────────────────
const sidebarList  = document.getElementById("sidebar-list");
const sidebarTitle = document.getElementById("sidebar-title");
const sidebarCount = document.getElementById("sidebar-count");
const sidebar      = document.getElementById("sidebar");
const toggleBtn    = document.getElementById("sidebar-toggle");

toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    toggleBtn.textContent = sidebar.classList.contains("collapsed") ? "▲" : "▼";
});

function buildAptSidebarCard(apt) {
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

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View on Apartments.com</a>` : "";

    const card = document.createElement("div");
    card.className = "sidebar-card";
    card.dataset.lat = apt.lat;
    card.dataset.lon = apt.lon;
    card.innerHTML = `<h3>${escapeHtml(title)}</h3>${badges}${rentBlock}${cta}`;
    return card;
}

function buildEventSidebarCard(ev) {
    const title   = ev.event_title || "Event";
    const address = ev.address     || "";
    const date    = ev.event_date  || "";
    const desc    = ev.description || "";
    const link    = ev.event_detail_url || null;

    let badges = `<div class="badges">`;
    if (date)    badges += `<span class="badge-item">${calIcon} ${escapeHtml(date)}</span>`;
    if (address) badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    badges += `</div>`;

    const descBlock = desc
        ? `<p class="evt-desc">${escapeHtml(desc.length > 100 ? desc.slice(0, 100) + "…" : desc)}</p>`
        : "";

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View on Catch Des Moines</a>` : "";

    const card = document.createElement("div");
    card.className = "sidebar-card";
    card.dataset.lat = ev.latitude;
    card.dataset.lon = ev.longitude;
    card.innerHTML = `<h3>${escapeHtml(title)}</h3>${badges}${descBlock}${cta}`;
    return card;
}

function populateSidebarApartments(apartments, maxPrice) {
    sidebarTitle.textContent = "Apartments";
    sidebarList.innerHTML = "";

    const filtered = apartments
        .filter(apt => apt.lat && apt.lon)
        .filter(apt => {
            const minPrice = getApartmentMinPrice(apt);
            return minPrice === null || minPrice <= maxPrice;
        });

    sidebarCount.textContent = `${filtered.length} listing${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
        sidebarList.innerHTML = `<div class="sidebar-empty">No apartments match the current filters.</div>`;
        return;
    }

    filtered.forEach(apt => {
        const card = buildAptSidebarCard(apt);
        card.addEventListener("click", () => {
            document.querySelectorAll(".sidebar-card").forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            map.flyTo({ center: [apt.lon, apt.lat], zoom: 15 });
            if (isMobile() && sidebar.classList.contains("collapsed")) {
                sidebar.classList.remove("collapsed");
                toggleBtn.textContent = "▼";
            }
        });
        sidebarList.appendChild(card);
    });
}

function populateSidebarEvents(events) {
    sidebarTitle.textContent = "Events";
    sidebarList.innerHTML = "";

    const filtered = events.filter(ev => ev.latitude != null && ev.longitude != null);
    sidebarCount.textContent = `${filtered.length} event${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
        sidebarList.innerHTML = `<div class="sidebar-empty">No events match the current filters.</div>`;
        return;
    }

    filtered.forEach(ev => {
        const card = buildEventSidebarCard(ev);
        card.addEventListener("click", () => {
            document.querySelectorAll(".sidebar-card").forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            map.flyTo({ center: [ev.longitude, ev.latitude], zoom: 15 });
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

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View on Apartments.com</a>` : "";

    return `<div class="apt-popup"><h3>${escapeHtml(title)}</h3>${badges}${rentBlock}${cta}</div>`;
}

function buildEventCardHTML(event) {
    const title   = event.event_title || "Event";
    const address = event.address     || "";
    const date    = event.event_date  || "";
    const desc    = event.description || "";
    const link    = event.event_detail_url || null;

    let badges = `<div class="badges">`;
    if (date)    badges += `<span class="badge-item">${calIcon} ${escapeHtml(date)}</span>`;
    if (address) badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    badges += `</div>`;

    const descBlock = desc
        ? `<p class="evt-desc">${escapeHtml(desc.length > 120 ? desc.slice(0, 120) + "…" : desc)}</p>`
        : "";

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View on Catch Des Moines</a>` : "";

    return `<div class="apt-popup"><h3>${escapeHtml(title)}</h3>${badges}${descBlock}${cta}</div>`;
}

// ── GeoJSON builders ───────────────────────────────────────────────────────────
function buildApartmentGeoJSON(apartments, maxPrice) {
    return {
        type: "FeatureCollection",
        features: apartments
            .filter(apt => apt.lat && apt.lon)
            .filter(apt => {
                const minPrice = getApartmentMinPrice(apt);
                return minPrice === null || minPrice <= maxPrice;
            })
            .map(apt => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [apt.lon, apt.lat] },
                properties: {
                    popupHTML: buildAptPopupHTML(apt),
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
        paint: { "circle-radius": 8, "circle-color": color, "circle-stroke-width": 2, "circle-stroke-color": "#fff" }
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

// ── Main ───────────────────────────────────────────────────────────────────────
let eventGroups = {};

map.on("load", () => {
    Promise.all([
        fetch("/data/apartments").then(r => r.json()),
        fetch("/data/events").then(r => r.json())
    ]).then(([apartments, events]) => {

        // ── DOM refs ────────────────────────────────────────────────────────
        const priceRange         = document.getElementById("priceRange");
        const priceValue         = document.getElementById("priceValue");
        const priceRangeMobile   = document.getElementById("priceRangeMobile");
        const priceValueMobile   = document.getElementById("priceValueMobile");
        const aptFiltersDesktop  = document.getElementById("apt-filters-desktop");
        const evtFiltersDesktop  = document.getElementById("evt-filters-desktop");
        const aptFiltersMobile   = document.getElementById("apt-filters-mobile");
        const evtFiltersMobile   = document.getElementById("evt-filters-mobile");
        const eventStartDate     = document.getElementById("eventStartDate");
        const eventEndDate       = document.getElementById("eventEndDate");
        const eventStartDateMob  = document.getElementById("eventStartDateMobile");
        const eventEndDateMob    = document.getElementById("eventEndDateMobile");

        // ── Sync desktop & mobile price sliders ─────────────────────────────
        function syncPrice(value) {
            priceRange.value       = value;
            priceValue.value       = value;
            priceRangeMobile.value = value;
            priceValueMobile.value = value;
            map.getSource("apartments").setData(buildApartmentGeoJSON(apartments, Number(value)));
            populateSidebarApartments(apartments, Number(value));
        }

        priceRange.addEventListener("input",         () => syncPrice(priceRange.value));
        priceRangeMobile.addEventListener("input",   () => syncPrice(priceRangeMobile.value));
        priceValue.addEventListener("change",        () => syncPrice(Math.max(500, Math.min(4000, Number(priceValue.value)))));
        priceValueMobile.addEventListener("change",  () => syncPrice(Math.max(500, Math.min(4000, Number(priceValueMobile.value)))));

        // ── Apartments layer ─────────────────────────────────────────────────
        addClusteredLayer("apartments", buildApartmentGeoJSON(apartments, 4000), "#3B82F6", "#2563EB", "#1E3A8A");
        populateSidebarApartments(apartments, 4000);

        map.on("click", "apartments-unclustered-point", e => {
            const coords = e.features[0].geometry.coordinates.slice();
            const { popupHTML } = e.features[0].properties;
            while (Math.abs(e.lngLat.lng - coords[0]) > 180)
                coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
            new mapboxgl.Popup({ offset: 12, maxWidth: "320px" })
                .setLngLat(coords).setHTML(popupHTML).addTo(map);
        });

        // ── Event categories ─────────────────────────────────────────────────
        const allCategories = collectEventCategories(events);
        buildEventCategoryFilters(allCategories, "eventCategoryFilters", false);
        buildEventCategoryFilters(allCategories, "eventCategoryFiltersMobile", true);

        // ── Events layer ─────────────────────────────────────────────────────
        function getActiveEventFilters() {
            const mobile = isMobile();
            return {
                startDate: (mobile ? eventStartDateMob : eventStartDate).value || null,
                endDate:   (mobile ? eventEndDateMob   : eventEndDate).value   || null,
                categories: getSelectedEventCategories(mobile ? "eventCategoryFiltersMobile" : "eventCategoryFilters")
            };
        }

        function updateEventLayer() {
            const { startDate, endDate, categories } = getActiveEventFilters();
            const filteredEvents = events.filter(ev => {
                if (ev.latitude == null || ev.longitude == null) return false;
                if (!eventMatchesDateRange(ev, startDate, endDate)) return false;
                if (!eventMatchesCategories(ev, categories)) return false;
                return true;
            });
            eventGroups = groupByCoord(filteredEvents);
            map.getSource("events").setData(buildEventGeoJSON(filteredEvents));
            populateSidebarEvents(filteredEvents);
        }

        [eventStartDate, eventEndDate].forEach(el => el.addEventListener("change", updateEventLayer));
        [eventStartDateMob, eventEndDateMob].forEach(el => el.addEventListener("change", updateEventLayer));
        document.getElementById("eventCategoryFilters").addEventListener("change", updateEventLayer);
        document.getElementById("eventCategoryFiltersMobile").addEventListener("change", updateEventLayer);

        const initialFilteredEvents = events.filter(ev => ev.latitude != null && ev.longitude != null);
        eventGroups = groupByCoord(initialFilteredEvents);
        addClusteredLayer("events", buildEventGeoJSON(initialFilteredEvents), "#EF4444", "#DC2626", "#991B1B");
        setLayerGroupVisibility("events", false);

        map.on("click", "events-unclustered-point", e => {
            const coords = e.features[0].geometry.coordinates.slice();
            const { coordKey } = e.features[0].properties;
            while (Math.abs(e.lngLat.lng - coords[0]) > 180)
                coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
            const eventsAtLocation = eventGroups[coordKey] || [];
            new mapboxgl.Popup({ offset: 12, maxWidth: "380px" })
                .setLngLat(coords).setDOMContent(buildEventCarouselNode(eventsAtLocation)).addTo(map);
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

            if (showApts) {
                populateSidebarApartments(apartments, Number(priceRange.value));
            } else {
                updateEventLayer();
            }
        }

        // Sync all radio buttons (desktop + mobile share the same `name="layer"`)
        document.querySelectorAll('input[name="layer"]').forEach(radio => {
            radio.addEventListener("change", e => {
                // Keep all radios with same value in sync
                document.querySelectorAll(`input[name="layer"]`).forEach(r => {
                    r.checked = r.value === e.target.value;
                });
                updateVisibleLayer(e.target.value);
            });
        });

        updateVisibleLayer("apartments");
    });
});
