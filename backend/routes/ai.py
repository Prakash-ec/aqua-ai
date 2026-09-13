from typing import Any

from fastapi import APIRouter

from backend.services.ai_provider import (
    PROVIDERS,
    get_available_providers,
    get_available_vision_providers,
)


router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


# =========================================================
# SAFE PROVIDER INFORMATION
# =========================================================

def provider_info(
    provider_id: str,
    provider: dict[str, Any],
) -> dict[str, Any]:
    """Return safe provider information without exposing API keys."""

    client_available = provider.get("client") is not None

    return {
        "id": provider_id,
        "name": provider.get("name", provider_id),
        "model": provider.get("model"),
        "vision_model": provider.get("vision_model"),
        "available": client_available,
        "supports_text": bool(
            provider.get("supports_text", True)
        ),
        "supports_vision": bool(
            provider.get("supports_vision", False)
        ),
    }


# =========================================================
# AVAILABLE PROVIDERS
# =========================================================

@router.get("/providers")
def list_ai_providers():
    """
    Return configured AI providers.

    API keys are never returned.
    """

    text_providers = get_available_providers()
    vision_providers = get_available_vision_providers()

    text_ids = {
        provider.get("id")
        for provider in text_providers
        if isinstance(provider, dict)
    }

    vision_ids = {
        provider.get("id")
        for provider in vision_providers
        if isinstance(provider, dict)
    }

    providers = []

    for provider_id, provider in PROVIDERS.items():
        if not isinstance(provider, dict):
            continue

        item = provider_info(
            provider_id=provider_id,
            provider=provider,
        )

        item["text_available"] = (
            provider_id in text_ids
        )

        item["vision_available"] = (
            provider_id in vision_ids
        )

        providers.append(item)

    return {
        "success": True,
        "providers": providers,
        "text_providers": [
            provider.get("id")
            for provider in text_providers
            if isinstance(provider, dict)
        ],
        "vision_providers": [
            provider.get("id")
            for provider in vision_providers
            if isinstance(provider, dict)
        ],
    }


# =========================================================
# CURRENT AI CONFIGURATION
# =========================================================

@router.get("/current")
def current_ai_configuration():
    """
    Return the default configured AI provider information.
    """

    available_text = get_available_providers()
    available_vision = get_available_vision_providers()

    current_text = (
        available_text[0]
        if available_text
        else None
    )

    current_vision = (
        available_vision[0]
        if available_vision
        else None
    )

    return {
        "success": True,
        "text": (
            {
                "provider": current_text.get("id"),
                "name": current_text.get("name"),
                "model": current_text.get("model"),
            }
            if current_text
            else None
        ),
        "vision": (
            {
                "provider": current_vision.get("id"),
                "name": current_vision.get("name"),
                "model": current_vision.get("model"),
            }
            if current_vision
            else None
        ),
    }


# =========================================================
# AI HEALTH
# =========================================================

@router.get("/health")
def ai_health():
    """
    Report whether text and vision AI providers are configured.
    """

    text_providers = get_available_providers()
    vision_providers = get_available_vision_providers()

    text_available = len(text_providers) > 0
    vision_available = len(vision_providers) > 0

    if text_available or vision_available:
        status = "healthy"
    else:
        status = "unavailable"

    return {
        "success": True,
        "status": status,
        "text_ai_available": text_available,
        "vision_ai_available": vision_available,
        "text_provider_count": len(text_providers),
        "vision_provider_count": len(vision_providers),
    }