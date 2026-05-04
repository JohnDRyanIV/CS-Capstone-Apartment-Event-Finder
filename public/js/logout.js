async function logoutCallback(response) {
    if (!response.ok) {
        alert("Logout failed: " + response.message);
        return;
    }
    // Display an alert notifying the user that they logged out
    alert("Logout successful!");
    // Have the user navigate to the home page.
    window.location.href = "/";
}

async function doLogout() {
    const request = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    };
    fetch("/logout", request)
        .then(logoutCallback)
        .catch(() => alert("An error occurred. Please try again."));
}

// boilerplate for registering new event handlers.
function onReady(callback) {
    document.readyState === "loading"
        ? document.addEventListener("DOMContentLoaded", callback)
        : callback();
}

// Add the event listener
function attachEventListeners() {
    // Search for the element with the id logoutButton. Note that
    // this means that we can only have one logout button on the page.
    const logoutButton = document.getElementById("logoutButton");
    logoutButton?.addEventListener("click", doLogout);
}

onReady(attachEventListeners);