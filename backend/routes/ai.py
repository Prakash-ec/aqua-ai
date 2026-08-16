from fastapi import APIRouter, HTTPException

from backend.services.ai_provider import (
    PROVIDERS,
    get_available_providers,
)


# =========================================================
# ROUTER
# =========================================================

router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


# =========================================================
# CURRENT PROVIDER
# =========================================================

CURRENT_PROVIDER = "groq"


# =========================================================
# PROVIDERS
# =========================================================

@router.get("/providers")
def providers():

    available = get_available_providers()

    return {
        "success": True,
        "current": CURRENT_PROVIDER,
        "providers": available,
    }


# =========================================================
# CURRENT
# =========================================================

@router.get("/current")
def current_provider():

    provider = PROVIDERS.get(
        CURRENT_PROVIDER
    )

    if provider is None:

        raise HTTPException(
            status_code=500,
            detail="Current AI provider is not configured.",
        )

    if provider["client"] is None:

        raise HTTPException(
            status_code=503,
            detail=(
                f"{provider['name']} API key is not configured."
            ),
        )

    return {
        "success": True,
        "provider": {
            "id": provider["id"],
            "name": provider["name"],
            "model": provider["model"],
        },
    }


# =========================================================
# HEALTH
# =========================================================

@router.get("/health")
def ai_health():

    available = get_available_providers()

    return {
        "success": True,
        "status": (
            "healthy"
            if available
            else "no_providers"
        ),
        "current_provider": CURRENT_PROVIDER,
        "available_providers": len(available),
    }