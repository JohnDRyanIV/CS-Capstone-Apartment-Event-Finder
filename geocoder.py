import json
import time
import requests

API_KEY = "69a9cc684f812398115701kef868290"
BASE_URL = "https://geocode.maps.co/search"
INFILE = "static/bs-results/apartments-test.json"

session = requests.Session()
session.headers.update({
    "User-Agent": "CS-Capstone-Geocoder/1.0 (contact: you@example.com)"
})

def geocode(address: str, retries: int = 4, timeout: int = 20):
    params = {"q": address, "api_key": API_KEY}

    for attempt in range(retries + 1):
        r = session.get(BASE_URL, params=params, timeout=timeout)

        # Retry on rate limit / transient errors
        if r.status_code in (429, 500, 502, 503, 504):
            wait = 1.0 * (2 ** attempt)
            time.sleep(wait)
            continue

        if not r.ok:
            # Not OK and not retryable
            snippet = (r.text or "")[:200].replace("\n", " ")
            print(f"[HTTP {r.status_code}] {address} -> {snippet}")
            return None

        try:
            data = r.json()
        except ValueError:
            snippet = (r.text or "")[:200].replace("\n", " ")
            print(f"[Bad JSON] {address} -> {snippet}")
            return None

        if isinstance(data, list) and data:
            return float(data[0]["lat"]), float(data[0]["lon"])
        return None

    print(f"[Retry exhausted] {address}")
    return None


with open(INFILE, "r", encoding="utf-8") as f:
    apartments = json.load(f)

changed = False

for i, apt in enumerate(apartments, start=1):
    address = apt.get("address")
    if not address:
        continue

    # Skip already done
    if "lat" in apt and "lon" in apt:
        continue

    result = geocode(address)
    if result:
        apt["lat"], apt["lon"] = result
        changed = True
        print(f"[{i}/{len(apartments)}] OK: {address} -> {apt['lat']}, {apt['lon']}")
    else:
        print(f"[{i}/{len(apartments)}] FAIL: {address}")

    # Pace for api rate limit.
    time.sleep(0.25)

    # Save incremental progress every time json is successfully updated
    if changed:
        with open(INFILE, "w", encoding="utf-8") as f:
            json.dump(apartments, f, indent=2)
        changed = False

print("Done.")