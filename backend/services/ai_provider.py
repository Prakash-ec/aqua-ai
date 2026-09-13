import base64
import json
import os
import re
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


load_dotenv()


# =========================================================
# ENVIRONMENT VARIABLES
# =========================================================

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()


# =========================================================
# MODEL CONFIGURATION
# =========================================================

OPENROUTER_MODEL = os.getenv(
    "OPENROUTER_MODEL",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
)

GROQ_MODEL = os.getenv(
    "GROQ_MODEL",
    "openai/gpt-oss-20b",
)

DEEPSEEK_MODEL = os.getenv(
    "DEEPSEEK_MODEL",
    "deepseek-chat",
)


# Groq vision model used by the camera-analysis feature
GROQ_VISION_MODEL = os.getenv(
    "GROQ_VISION_MODEL",
    "qwen/qwen3.6-27b",
)


# Optional vision models for other providers.
# Leave empty if the provider does not support your selected model.
OPENROUTER_VISION_MODEL = os.getenv(
    "OPENROUTER_VISION_MODEL",
    "",
).strip()

DEEPSEEK_VISION_MODEL = os.getenv(
    "DEEPSEEK_VISION_MODEL",
    "",
).strip()


# =========================================================
# CLIENT CREATION
# =========================================================

def create_client(
    api_key: str,
    base_url: str,
) -> OpenAI | None:
    """
    Create an OpenAI-compatible client only when an API key exists.
    """

    if not api_key:
        return None

    return OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=60.0,
        max_retries=0,
    )


openrouter_client = create_client(
    api_key=OPENROUTER_API_KEY,
    base_url="https://openrouter.ai/api/v1",
)

groq_client = create_client(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)

deepseek_client = create_client(
    api_key=DEEPSEEK_API_KEY,
    base_url="https://api.deepseek.com",
)


# =========================================================
# PROVIDER REGISTRY
# =========================================================

PROVIDERS: dict[str, dict[str, Any]] = {
    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter",
        "client": openrouter_client,
        "model": OPENROUTER_MODEL,
        "vision_model": OPENROUTER_VISION_MODEL or None,
        "supports_text": openrouter_client is not None,
        "supports_vision": (
            openrouter_client is not None
            and bool(OPENROUTER_VISION_MODEL)
        ),
    },
    "groq": {
        "id": "groq",
        "name": "Groq",
        "client": groq_client,
        "model": GROQ_MODEL,
        "vision_model": GROQ_VISION_MODEL,
        "supports_text": groq_client is not None,
        "supports_vision": groq_client is not None,
        # qwen3 vision models are reasoning models: they burn the
        # whole token budget on hidden reasoning before answering.
        # "none" disables thinking so the JSON answer is produced
        # directly. Set GROQ_REASONING_EFFORT= (empty) in .env to
        # omit this parameter for models that do not support it.
        "reasoning_effort": os.getenv(
            "GROQ_REASONING_EFFORT",
            "none",
        ).strip(),
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "client": deepseek_client,
        "model": DEEPSEEK_MODEL,
        "vision_model": DEEPSEEK_VISION_MODEL or None,
        "supports_text": deepseek_client is not None,
        "supports_vision": (
            deepseek_client is not None
            and bool(DEEPSEEK_VISION_MODEL)
        ),
    },
}


# =========================================================
# PROVIDER INFORMATION
# =========================================================

def get_available_providers() -> list[dict[str, Any]]:
    """
    Return providers that have a configured API client
    and support text generation.
    """

    available = []

    for provider in PROVIDERS.values():
        if (
            provider.get("client") is not None
            and provider.get("supports_text") is True
        ):
            available.append(
                {
                    "id": provider["id"],
                    "name": provider["name"],
                    "model": provider["model"],
                    "supports_text": True,
                    "supports_vision": provider.get(
                        "supports_vision",
                        False,
                    ),
                }
            )

    return available


def get_available_vision_providers() -> list[dict[str, Any]]:
    """
    Return providers that are configured for vision requests.
    """

    available = []

    for provider in PROVIDERS.values():
        if (
            provider.get("client") is not None
            and provider.get("supports_vision") is True
            and provider.get("vision_model")
        ):
            available.append(
                {
                    "id": provider["id"],
                    "name": provider["name"],
                    "model": provider["vision_model"],
                    "supports_text": provider.get(
                        "supports_text",
                        False,
                    ),
                    "supports_vision": True,
                }
            )

    return available


def get_provider(provider_id: str) -> dict[str, Any] | None:
    """
    Get one provider by its ID.
    """

    if not provider_id:
        return None

    return PROVIDERS.get(provider_id.lower().strip())


# =========================================================
# ERROR HANDLING
# =========================================================

def get_error_text(error: Exception) -> str:
    """
    Convert provider exceptions into readable text.
    """

    error_text = str(error).strip()

    if not error_text:
        error_text = error.__class__.__name__

    return error_text


def is_retryable_provider_error(error: Exception) -> bool:
    """
    Identify errors for which another provider should be tried.
    """

    error_text = get_error_text(error).lower()

    retryable_words = [
        "429",
        "rate limit",
        "rate_limit",
        "quota",
        "credit",
        "credits",
        "insufficient",
        "too many requests",
        "timeout",
        "timed out",
        "connection",
        "temporarily unavailable",
        "service unavailable",
        "server error",
        "internal server error",
        "bad gateway",
        "gateway timeout",
        "overloaded",
    ]

    return any(
        word in error_text
        for word in retryable_words
    )


# =========================================================
# RESPONSE PARSING
# =========================================================

def strip_reasoning_blocks(text: Any) -> str:
    """
    Remove reasoning blocks that reasoning models emit before
    their actual answer (e.g. Groq qwen models emit
    ...
answer ...).

    Handles:
    - complete blocks: <think>reasoning</think>answer -> answer
    - trailing whitespace around the block
    - unclosed blocks: the model spent its entire token budget on
      reasoning and never produced an answer, so treat the whole
      text as empty reasoning content.
    """

    if not isinstance(text, str) or not text:
        return ""

    lowered = text.lower()

    if "<think>" in lowered:
        if "</think>" in lowered:
            cleaned = re.sub(
                r"<think>.*?</think>",
                "",
                text,
                flags=re.DOTALL | re.IGNORECASE,
            )
            return cleaned.strip()

        # Unclosed <think> block: no answer was produced.
        return ""

    return text.strip()


def extract_response_text(response: Any) -> str:
    """
    Safely extract text from an OpenAI-compatible response.

    Supports:
    - Normal string content
    - List-based content blocks
    - Dictionary-based content blocks
    """

    try:
        message = response.choices[0].message
        content = message.content
    except Exception:
        return ""

    if content is None:
        return ""

    if isinstance(content, str):
        return strip_reasoning_blocks(content)

    if isinstance(content, list):
        output_parts: list[str] = []

        for item in content:
            if isinstance(item, str):
                output_parts.append(item)

            elif isinstance(item, dict):
                text_value = item.get("text")

                if text_value:
                    output_parts.append(str(text_value))

            else:
                text_value = getattr(item, "text", None)

                if text_value:
                    output_parts.append(str(text_value))

        return strip_reasoning_blocks(
            "\n".join(output_parts)
        )

    return strip_reasoning_blocks(str(content))


# =========================================================
# PROVIDER ORDER
# =========================================================

def build_text_provider_order(
    preferred_provider: str | None = None,
) -> list[str]:
    """
    Build the provider fallback order.

    Preferred provider is attempted first, followed by:
    Groq -> DeepSeek -> OpenRouter.
    """

    default_order = [
        "groq",
        "deepseek",
        "openrouter",
    ]

    order: list[str] = []

    if preferred_provider:
        preferred = preferred_provider.lower().strip()

        if preferred in PROVIDERS:
            order.append(preferred)

    for provider_id in default_order:
        if provider_id not in order:
            order.append(provider_id)

    return order


def build_vision_provider_order(
    preferred_provider: str | None = None,
) -> list[str]:
    """
    Build the provider fallback order for image analysis.
    """

    default_order = [
        "groq",
        "openrouter",
        "deepseek",
    ]

    order: list[str] = []

    if preferred_provider:
        preferred = preferred_provider.lower().strip()

        if preferred in PROVIDERS:
            order.append(preferred)

    for provider_id in default_order:
        if provider_id not in order:
            order.append(provider_id)

    return order


# =========================================================
# TEXT PROVIDER CALL
# =========================================================

def call_provider(
    provider_id: str,
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 700,
) -> dict[str, Any]:
    """
    Call one text-generation provider.
    """

    provider = get_provider(provider_id)

    if provider is None:
        raise RuntimeError(
            f"Unknown AI provider: {provider_id}"
        )

    client = provider.get("client")

    if client is None:
        raise RuntimeError(
            f"{provider['name']} API key is not configured."
        )

    if not provider.get("supports_text"):
        raise RuntimeError(
            f"{provider['name']} does not support text generation."
        )

    selected_model = model or provider["model"]

    if not selected_model:
        raise RuntimeError(
            f"No model configured for {provider['name']}."
        )

    response = client.chat.completions.create(
        model=selected_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    answer = extract_response_text(response)

    if not answer:
        raise RuntimeError(
            f"{provider['name']} returned an empty response."
        )

    return {
        "success": True,
        "provider": provider_id,
        "provider_name": provider["name"],
        "model": selected_model,
        "answer": answer,
    }


# =========================================================
# TEXT AI WITH FALLBACK
# =========================================================

def ask_ai(
    messages: list[dict[str, Any]],
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 700,
) -> dict[str, Any]:
    """
    Ask an AI provider a text question.

    If the selected provider fails, another configured provider
    is automatically attempted.
    """

    provider_order = build_text_provider_order(provider)
    errors: list[dict[str, str]] = []

    for provider_id in provider_order:
        provider_config = get_provider(provider_id)

        if provider_config is None:
            continue

        if provider_config.get("client") is None:
            continue

        if not provider_config.get("supports_text"):
            continue

        selected_model = model

        # A user-specified model is used only for the preferred
        # provider. Fallback providers use their own configured model.
        if provider_id != provider and provider is not None:
            selected_model = None

        try:
            return call_provider(
                provider_id=provider_id,
                messages=messages,
                model=selected_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        except Exception as error:
            errors.append(
                {
                    "provider": provider_id,
                    "error": get_error_text(error),
                }
            )

            # Continue to the next provider for all provider errors.
            # This is useful when a provider has exhausted its quota.
            continue

    error_summary = "; ".join(
        f"{item['provider']}: {item['error']}"
        for item in errors
    )

    raise RuntimeError(
        "All configured AI providers failed."
        + (f" Details: {error_summary}" if error_summary else "")
    )


# =========================================================
# IMAGE ENCODING
# =========================================================

def image_to_data_url(
    image_bytes: bytes,
    content_type: str = "image/jpeg",
) -> str:
    """
    Convert image bytes into a base64 data URL.
    """

    encoded_image = base64.b64encode(
        image_bytes
    ).decode("utf-8")

    return (
        f"data:{content_type};base64,"
        f"{encoded_image}"
    )


# =========================================================
# VISION PROVIDER CALL
# =========================================================

def call_vision_provider(
    provider_id: str,
    image_bytes: bytes,
    prompt: str,
    content_type: str = "image/jpeg",
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 1500,
) -> dict[str, Any]:
    """
    Call one vision-capable provider.
    """

    provider = get_provider(provider_id)

    if provider is None:
        raise RuntimeError(
            f"Unknown AI provider: {provider_id}"
        )

    client = provider.get("client")

    if client is None:
        raise RuntimeError(
            f"{provider['name']} API key is not configured."
        )

    if not provider.get("supports_vision"):
        raise RuntimeError(
            f"{provider['name']} is not configured for vision."
        )

    selected_model = model or provider.get("vision_model")

    if not selected_model:
        raise RuntimeError(
            f"No vision model configured for {provider['name']}."
        )

    image_data_url = image_to_data_url(
        image_bytes=image_bytes,
        content_type=content_type,
    )

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt,
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_data_url,
                    },
                },
            ],
        }
    ]

    request_kwargs: dict[str, Any] = {
        "model": selected_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    # Reasoning-capable vision models (e.g. Groq qwen3) need this
    # to avoid spending the entire token budget on hidden reasoning.
    # extra_body is used so provider-specific parameters pass
    # through regardless of the installed OpenAI SDK version.
    reasoning_effort = provider.get("reasoning_effort")

    if reasoning_effort:
        request_kwargs["extra_body"] = {
            "reasoning_effort": reasoning_effort,
        }

    response = client.chat.completions.create(
        **request_kwargs
    )

    answer = extract_response_text(response)

    if not answer:
        raise RuntimeError(
            f"{provider['name']} returned an empty vision response."
        )

    return {
        "success": True,
        "provider": provider_id,
        "provider_name": provider["name"],
        "model": selected_model,
        "answer": answer,
    }


# =========================================================
# VISION AI WITH FALLBACK
# =========================================================

def ask_vision_ai(
    image_bytes: bytes,
    prompt: str,
    provider: str | None = None,
    model: str | None = None,
    content_type: str = "image/jpeg",
    temperature: float = 0.2,
    max_tokens: int = 1500,
) -> dict[str, Any]:
    """
    Analyze an image using a vision-capable provider.

    Groq is the default because the configured Groq model supports
    image input. Other providers are used only when a vision model
    is explicitly configured for them.
    """

    provider_order = build_vision_provider_order(provider)
    errors: list[dict[str, str]] = []

    for provider_id in provider_order:
        provider_config = get_provider(provider_id)

        if provider_config is None:
            continue

        if provider_config.get("client") is None:
            continue

        if not provider_config.get("supports_vision"):
            continue

        selected_model = model

        # Use the requested model only for the preferred provider.
        if provider_id != provider and provider is not None:
            selected_model = None

        try:
            return call_vision_provider(
                provider_id=provider_id,
                image_bytes=image_bytes,
                prompt=prompt,
                content_type=content_type,
                model=selected_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        except Exception as error:
            errors.append(
                {
                    "provider": provider_id,
                    "error": get_error_text(error),
                }
            )

            continue

    error_summary = "; ".join(
        f"{item['provider']}: {item['error']}"
        for item in errors
    )

    raise RuntimeError(
        "All configured vision providers failed."
        + (f" Details: {error_summary}" if error_summary else "")
    )


# =========================================================
# DEBUG INFORMATION
# =========================================================

def get_provider_debug_info() -> dict[str, Any]:
    """
    Return safe provider information without exposing API keys.
    """

    return {
        "openrouter_key_loaded": bool(OPENROUTER_API_KEY),
        "groq_key_loaded": bool(GROQ_API_KEY),
        "deepseek_key_loaded": bool(DEEPSEEK_API_KEY),
        "text_providers": get_available_providers(),
        "vision_providers": get_available_vision_providers(),
    }