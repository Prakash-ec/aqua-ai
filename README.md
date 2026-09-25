# Aqua AI

Aqua AI is a FastAPI water-quality dashboard with sensor readings, AI chat, and image analysis.

## Run locally

Install the dependencies, provide `DATABASE_URL` and any AI provider keys in a local `.env` file, then start FastAPI:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8002
```

Open [http://127.0.0.1:8002](http://127.0.0.1:8002). FastAPI serves both the frontend and API, so the dashboard uses the same origin automatically. Do not open `frontend/index.html` directly with a `file:` URL: browsers block its API requests for security.

Alternatively, serve the `frontend/` folder separately (e.g. VS Code Live Server) on `http://127.0.0.1:5501`; the frontend targets the local backend at `http://127.0.0.1:8002` automatically.

## Deploy to Render

The repository includes `render.yaml` for a Python web service. Connect or sync this Blueprint in Render, set `DATABASE_URL` plus any needed AI provider keys, and enable auto-deploy for the `main` branch. Render will build the service, run Uvicorn, and check `/health` before routing traffic.
