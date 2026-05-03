// database.js — shared utility for handling database availability responses.
// Linked in navbar.html so it's available on every page.

function handle503(response) {
    if (response.status !== 503) return false;
    showDbToast("⏳ Database is waking up — please try again in a few seconds.");
    return true;
}

function showDbToast(message) {
    let toast = document.getElementById("db-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "db-toast";
        toast.style.cssText = [
            "position:fixed",
            "bottom:24px",
            "left:50%",
            "transform:translateX(-50%)",
            "background:#1a1a1a",
            "color:#fff",
            "padding:10px 20px",
            "border-radius:10px",
            "font-family:var(--font-serif,serif)",
            "font-size:13px",
            "z-index:9999",
            "opacity:0",
            "transition:opacity 0.2s",
            "pointer-events:none",
            "white-space:nowrap",
        ].join(";");
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, 4000);
}

async function checkAuthStatus() {
    try {
        const res = await fetch("/api/auth", { credentials: "include" });
        if (res.status === 401) {
            // Cookie exists but session is invalid/expired — update UI
            document.querySelectorAll(".requires-auth").forEach(el => el.style.display = "none");
        }
    } catch (e) {}
}

document.addEventListener("DOMContentLoaded", checkAuthStatus);
