# Aqua AI - Architectural Reference

This document serves as the primary architectural reference for the Aqua AI project. It describes the **current, real implementation** of the system. Future AI coding agents should consult this document before attempting modifications to understand boundaries, existing patterns, and explicit constraints.

## 1. Introduction & Overview
Aqua AI is a smart water quality monitoring application that integrates hardware sensors (ESP32) with a web-based dashboard and AI-driven features. It consists of a static HTML/JS/CSS frontend and a Python/FastAPI backend backed by a PostgreSQL database.

## 2. System Architecture
The system follows a client-server architecture:
- **Client**: Vanilla HTML/JS/CSS single-page application (SPA).
- **Server**: FastAPI REST API providing data ingestion, retrieval, and AI integrations.
- **Database**: PostgreSQL database handling persistence.
- **Hardware**: ESP32 microcontrollers pushing telemetry directly to the backend.

## 3. Technology Stack
- **Frontend**: HTML5, CSS3 (CSS Variables for theming), Vanilla JavaScript (ES6+).
- **Backend**: Python 3, FastAPI, SQLAlchemy (ORM), Pydantic (Validation).
- **Database**: PostgreSQL (Neon).
- **Deployment**: Render (Backend API), Netlify (Frontend).

## 4. Project Directory Structure
```
D:\aqua-ai\
├── frontend/           # Static frontend assets
│   ├── index.html      # Main application view and structure
│   ├── app.js          # Core frontend logic, routing, and scoring
│   └── style.css       # Theming and layout styles
├── backend/            # FastAPI backend application
│   ├── main.py         # App entry point, CORS, and initialization
│   ├── models.py       # SQLAlchemy database models
│   ├── routes/         # API endpoints (e.g., readings, camera, chat)
│   ├── services/       # Core business logic and integrations
│   └── agents/         # AI integrations and agents
└── PROJECT_STRUCTURE.md# This architectural reference file
```

## 5. Frontend Application Core (`index.html`)
The frontend is a monolithic Single Page Application. `index.html` contains the entire structure of the application, utilizing `<section>` tags for distinct views. There is no frontend build process (e.g., Webpack/Vite).

## 6. Frontend Navigation & Routing
Routing is handled client-side via a custom hash-based router function (`navigateTo()`) in `app.js`. It toggles `active` and `hidden` classes on DOM elements to display views.
- **Current Navigation Groups**: MONITORING (Dashboard, Trends, Device), INTELLIGENCE (Analysis, AI Camera, AI Chat), REPORTING (Reports), SYSTEM (Settings, Profile).
- **Virtual Pages**: Routes like `"chat"` scroll to specific widgets on the Dashboard instead of opening new views.

## 7. Frontend Themes & Styling (`style.css`)
Styling uses plain CSS. Dark mode is managed via the `data-theme="dark"` attribute on the root `<html>` element, which triggers CSS variable overrides at the bottom of `style.css`. The design is optimized for a professional monitoring interface.

## 8. Frontend Logic & State (`app.js`)
`app.js` is a large (~6700 lines) monolithic JavaScript file managing state, API interactions, UI updates, chart rendering (Chart.js), routing, and chat interactions. Modifications to frontend logic generally target specific blocks within this file.

## 9. Water Quality Scoring (Deterministic)
The system calculates water quality application scores (e.g., Drinking, Swimming, Agriculture) deterministically. **LLMs are explicitly NOT used to replace this deterministic scoring logic.** The algorithms reside completely within `app.js` (e.g., `computeReadingQuality`, `calculateApplicationScore`).
- **Continuous Monotonic Formulas**: Parameters are scored 0-100 using continuous decay functions to avoid discontinuities.
- **Analytical Safeguard**: If any critical parameter score reaches 0 (fatal limit), the overall application suitability score is strictly capped at a low value (e.g., 20) to prevent a "Good" rating for hazardous water.
- **Salinity**: EC is strictly labeled as "Estimated EC" (TDS/650).

## 10. Backend API Framework
The backend is built with **FastAPI**. `backend/main.py` bootstraps the application, mounts API routers from `backend/routes/`, configures CORS, and optionally serves the static frontend files.

## 11. Database Schema Overview
The database uses SQLAlchemy ORM (`backend/models.py`). Migrations are additive. Existing tables are verified on startup without destructive modifications.

## 12. Database Models (Core)
- **Device**: Represents ESP32 units (Fields: `id`, `name`, `device_type`, `location`, `is_active`).
- **WaterReading**: Sensor telemetry (Fields: `device_id`, `temperature`, `ph`, `turbidity`, `tds`, `recorded_at`).

## 13. Database Models (AI & Users)
- **CameraPrediction**: Logs visual analysis from the AI camera (Fields: `image_path`, `prediction`, `confidence`, `details`).
- **User / UserSession**: Schema exists but is not enforced for general API use due to intentional architectural decisions.

## 14. Authentication & Security (Intentional State)
**Authentication has intentionally been removed.** The current architecture is public and unauthenticated. Do NOT add authentication or attempt to secure endpoints. The system is designed for demo/local use without login walls.

## 15. Hardware Integration (ESP32)
ESP32 microcontrollers are the primary source of telemetry. They send JSON payloads containing raw sensor values directly to the backend.

## 16. Telemetry Ingestion API
**Endpoint:** `POST /readings/ingest`
- **Format**:
```json
{
  "device_id": 1,
  "temperature": 27.5,
  "ph": 7.2,
  "turbidity": 1.8,
  "tds": 320
}
```
- **Validation**: Bounds checking is enforced (e.g., pH 0-14). Devices must be marked active.

## 17. Sensor Data Retrieval APIs
Data is accessed via public endpoints (e.g., `GET /readings/`, `GET /readings/latest`, `GET /readings/device/{device_id}`). They return historical arrays or single latest reading objects for frontend visualization.

## 18. AI Chatbot Integration
The backend supports an AI chatbot via `POST /chat/water` (or similar configured route in `backend/routes/chat.py`). It accesses water quality context but does NOT alter deterministic system states.

## 19. AI Camera Visual Analysis
The system supports visual analysis via `POST /camera/analyze`.
- **Constraint**: Camera analysis is strictly **visual-only** and must NOT infer quantitative metrics like exact pH, TDS, temperature, or turbidity.

## 20. Cross-Origin Resource Sharing (CORS)
CORS is configured in `backend/main.py` to allow origins like `localhost`, local IPs, and specific Netlify production domains (`https://vacproject.netlify.app`, `https://aqua-ai-frontend.netlify.app`).

## 21. Deployment & Infrastructure
- **Production Backend**: `https://aqua-ai-wz4s.onrender.com`
- **Production Frontend**: `https://vacproject.netlify.app`
- **Local Backend**: `http://127.0.0.1:8001`
- **Local Frontend**: `http://127.0.0.1:5500` (or similar)

## 22. Frontend Removed Pages & Deprecations
The standalone pages for Temperature, pH, Turbidity, and TDS have been **intentionally removed**. They were deemed redundant as the Trends page provides historical visualization for all four parameters. **Do NOT bring these navigation items back.**

## 23. Constraints & Design Decisions
- **No Backend Modifications**: Do not change backend API contracts unless absolutely necessary.
- **No Fake Data**: Do not create or generate fake backend data.
- **ESP32 Compatibility**: Do not change the ESP32 ingestion API contract (`/readings/ingest`).

## 24. Extensibility Guidelines
When adding features:
- Limit frontend logic to `app.js`.
- Target specific functions. Avoid global rewrites.
- Ensure any new UI aligns with the current dark theme CSS variables and professional monitoring aesthetic.

## 25. Environment Variables & Configuration
The system relies on a `.env` file for API keys (e.g., OpenRouter, Groq, DeepSeek, DB credentials). The backend gracefully handles missing AI keys by disabling specific AI routes rather than crashing the application.
