# Aqua AI

Aqua AI is a FastAPI water-quality dashboard with sensor readings, AI chat, and image analysis.

## Run locally

Install the dependencies, provide `DATABASE_URL` and any AI provider keys in a local `.env` file, then start FastAPI:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). FastAPI serves both the frontend and API, so the dashboard uses the same origin automatically. Do not open `frontend/index.html` directly with a `file:` URL: browsers block its API requests for security.

## Deploy to Render

The repository includes `render.yaml` for a Python web service. Connect or sync this Blueprint in Render, set `DATABASE_URL` plus any needed AI provider keys, and enable auto-deploy for the `main` branch. Render will build the service, run Uvicorn, and check `/health` before routing traffic.
