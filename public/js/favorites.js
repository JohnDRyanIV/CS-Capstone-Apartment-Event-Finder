const pinIcon   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
const calIcon   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const phoneIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.93 5.18 2 2 0 012.92 3h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 10.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`;

function escapeHtml(text) {
    if (!text) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatEventDate(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    const hasTime = !isoStr.endsWith("T23:59:59");
    const datePart = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (!hasTime) return datePart;
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${datePart} · ${timePart}`;
}

async function removeFavorite(itemId, itemType, cardEl) {
    try {
        const res = await fetch("/api/favorites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_id: String(itemId), item_type: itemType }),
            credentials: "include"
        });
        if (handle503(res)) return;
        if (!res.ok) return;
        cardEl.closest(".col").remove();
        checkEmpty();
    } catch (e) {
        console.error("Failed to remove favorite", e);
    }
}

function checkEmpty() {
    const aptGrid = document.getElementById("apartments-grid");
    const evtGrid = document.getElementById("events-grid");
    if (aptGrid.children.length === 0)
        aptGrid.innerHTML = `<div class="col"><div class="empty-state">No favorited apartments.</div></div>`;
    if (evtGrid.children.length === 0)
        evtGrid.innerHTML = `<div class="col"><div class="empty-state">No favorited events.</div></div>`;
}

function buildAptCard(apt) {
    const title   = apt.title || apt.address || "Apartment";
    const address = apt.address || "";
    const phone   = apt.phone_number || null;
    const link    = apt.link || null;
    const rent    = apt.rent_by_bed;

    let badges = `<div class="d-flex flex-column gap-1 mb-2">`;
    if (address) badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    if (phone)   badges += `<span class="badge-item">${phoneIcon} ${escapeHtml(phone)}</span>`;
    badges += `</div>`;

    let rentBlock = "";
    if (rent && Object.keys(rent).length > 0) {
        rentBlock = `<div class="rent-block"><strong>Rent</strong><ul>`;
        for (const [bed, price] of Object.entries(rent))
            rentBlock += `<li>${escapeHtml(bed)} — ${escapeHtml(price)}</li>`;
        rentBlock += `</ul></div>`;
    }

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View on Apartments.com</a>` : "";

    const col = document.createElement("div");
    col.className = "col";
    col.innerHTML = `
        <div class="fav-card">
            <h3>${escapeHtml(title)}</h3>
            ${badges}
            ${rentBlock}
            <div class="card-footer-row">
                ${cta}
                <button class="remove-btn">♥ Remove</button>
            </div>
        </div>`;

    col.querySelector(".remove-btn").addEventListener("click", () =>
        removeFavorite(apt.listing_id, "apartment", col.querySelector(".fav-card")));
    return col;
}

function buildEventCard(ev) {
    const title   = ev.event_title || "Event";
    const address = ev.address || "";
    const dateStr = formatEventDate(ev.event_start_date) || ev.event_date || "";
    const desc    = ev.description || "";
    const link    = ev.event_detail_url || null;

    let badges = `<div class="d-flex flex-column gap-1 mb-2">`;
    if (dateStr) badges += `<span class="badge-item">${calIcon} ${escapeHtml(dateStr)}</span>`;
    if (address) badges += `<span class="badge-item">${pinIcon} ${escapeHtml(address)}</span>`;
    badges += `</div>`;

    const descBlock = desc
        ? `<p style="font-size:13px;color:#666;margin:0 0 8px">${escapeHtml(desc.length > 120 ? desc.slice(0, 120) + "…" : desc)}</p>`
        : "";

    const cta = link ? `<a class="cta" href="${escapeHtml(link)}" target="_blank">View on Catch Des Moines</a>` : "";

    const col = document.createElement("div");
    col.className = "col";
    col.innerHTML = `
        <div class="fav-card">
            <h3>${escapeHtml(title)}</h3>
            ${badges}
            ${descBlock}
            <div class="card-footer-row">
                ${cta}
                <button class="remove-btn">♥ Remove</button>
            </div>
        </div>`;

    col.querySelector(".remove-btn").addEventListener("click", () =>
        removeFavorite(ev.id, "event", col.querySelector(".fav-card")));
    return col;
}

async function loadFavorites() {
    const [favsRes, aptsRes, evtsRes] = await Promise.all([
        fetch("/api/favorites", { credentials: "include" }),
        fetch("/data/apartments"),
        fetch("/data/events")
    ]);

    if (handle503(favsRes)) {
        document.getElementById("loading").textContent = "⏳ Database is waking up — please refresh in a few seconds.";
        return;
    }

    if (!favsRes.ok) {
        document.getElementById("loading").textContent = "Please log in to view your favorites.";
        return;
    }

    const [favsData, apartments, events] = await Promise.all([
        favsRes.json(), aptsRes.json(), evtsRes.json()
    ]);

    // Build lookup maps
    const aptById = {};
    apartments.forEach(a => { if (a.listing_id) aptById[a.listing_id] = a; });
    const evtById = {};
    events.forEach(e => { if (e.id) evtById[e.id] = e; });

    const aptGrid = document.getElementById("apartments-grid");
    const evtGrid = document.getElementById("events-grid");

    favsData.favorites.forEach(fav => {
        if (fav.item_type === "apartment") {
            const apt = aptById[fav.item_id];
            if (apt) aptGrid.appendChild(buildAptCard(apt));
        } else if (fav.item_type === "event") {
            const ev = evtById[fav.item_id];
            if (ev) evtGrid.appendChild(buildEventCard(ev));
        }
    });

    checkEmpty();
    document.getElementById("loading").style.display = "none";
    document.getElementById("content").style.display = "block";
}

loadFavorites();