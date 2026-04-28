# Apartment & Event Finder *(WIP)*
 
A web application for exploring apartments and local events in Des Moines, Iowa. Built with Flask and Mapbox GL JS, it pulls live data from Azure Blob Storage and displays it on an interactive map with filtering and a responsive sidebar.
 
---
 
## Team
 
| Name | Role |
|------|------|
| [John Ryan] | [Web Scraping & Mapping] |
| [Elisabeth Oguntona] | [UI Development] |
| [Lawton Peng] | [Web Scraping & Sorting] |
 
---
 
## Features
 
- **Interactive map** — Apartment listings and local events displayed as clustered pins via Mapbox GL JS
- **Apartment filters** — Filter by maximum rent price
- **Event filters** — Filter by date range and category; past events are automatically hidden
- **Responsive design** — Desktop sidebar layout collapses to a bottom drawer on mobile
- **Live data** — JSON data served from Azure Blob Storage via Flask routes
- **User accounts** — Registration, login, and session management backed by Azure SQL
---
 
## Tech Stack
 
| Layer | Technology |
|-------|------------|
| Backend | Python, Flask, Flask-RESTful |
| Storage | Azure Blob Storage |
| Frontend | HTML, Bootstrap 5, Mapbox GL JS |
| Scraping | Playwright, BeautifulSoup |
| Hosting | Azure App Service |
 
---