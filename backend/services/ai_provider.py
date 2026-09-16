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


# Groq vision model used by the camera-analysis feature.
# qwen/qwen3.8-27b is the Groq-hosted model that accepts image input.
# Verified against GET https://api.groq.com/openai/v1/models — the
# previous defaults are no longer selectable:
#   meta-llama/llama-4-scout-17b-16e-instruct -> 404 (removed by Groq)
#   qwen/qwen3.6-27b                          -> 404 (slug typo, 3.8 is correct)
#   openai/gpt-oss-*, groq/compound*          -> text only; reject image parts
# If .env sets GROQ_VISION_MODEL, that value wins at runtime.
GROQ_VISION_MODEL = os.getenv(
    "GROQ_VISION_MODEL",
    "qwen/qwen3.8-27b",
).strip()


# Optional vision models for other providers.
# NOTE: OpenRouter free vision slugs change often. The previous
# default qwen/qwen2.5-vl-72b-instruct:free now returns 404
# ("use paid slug instead"), so the default is OFF until a working
# free vision slug is confirmed. Set OPENROUTER_VISION_MODEL in .env
# to re-enable the OpenRouter fallback, e.g.:
# OPENROUTER_VISION_MODEL=qwen/qwen2.5-vl-72b-instruct:free
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
        # Registry: reasoning_effort="none" disables qwen thinking so
        # the 700-token budget is spent on the JSON answer instead of
        # an unclosed <think> block (which caused empty responses).
        # Sent ONLY for qwen vision models (see call_vision_provider).
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
    - Provider reasoning fields (checked only as fallback)
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

        joined = strip_reasoning_blocks(
            "\n".join(output_parts)
        )

        if joined:
            return joined

        # Fall through to reasoning/refusal fallback below so a
        # list-shaped (but textless) message still gets diagnosed
        # instead of being reported as a bare empty string.
        content = None

    if isinstance(content, str):
        cleaned = strip_reasoning_blocks(content)

        if cleaned:
            return cleaned

        # content existed but held only reasoning (e.g. unclosed
        # <think> block truncated by finish_reason="length").
        # Fall through to the reasoning fallback below.
    elif content is not None:
        cleaned = strip_reasoning_blocks(str(content))

        if cleaned:
            return cleaned

    # ---------------------------------------------------------
    # Fallback: provider-specific reasoning / refusal fields.
    # Only reached when message.content yielded no usable text.
    # Reasoning is returned ONLY when it is the sole usable output
    # and it contains non-empty text after stripping think tags.
    # ---------------------------------------------------------

    try:
        message_obj = response.choices[0].message
    except Exception:
        return ""

    for field_name in (
        "reasoning_content",
        "reasoning",
    ):
        try:
            reasoning_value = getattr(message_obj, field_name, None)
        except Exception:
            reasoning_value = None

        if reasoning_value:
            cleaned_reasoning = strip_reasoning_blocks(
                str(reasoning_value)
            )

            if cleaned_reasoning:
                return cleaned_reasoning

    try:
        refusal_value = getattr(message_obj, "refusal", None)
    except Exception:
        refusal_value = None

    if refusal_value:
        return str(refusal_value).strip()

    return ""


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
    max_tokens: int = 700,
) -> dict[str, Any]:
    """
    Call one vision-capable provider.

    The default output budget is intentionally conservative (700)
    because Groq enforces a 1000 output-tokens-per-minute limit on
    qwen/qwen3.6-27b; requesting ~1000+ (e.g. the old 1500 default,
    observed by Groq as 1020 requested vs 1000 limit) fails with
    HTTP 429 rate_limit_exceeded. Camera analysis stays complete
    well within 700 tokens because the prompt requires short fields.
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

    # qwen3 vision models use server-side reasoning. When thinking is
    # left at its default, the model spends the whole output budget
    # inside an unclosed <think>...</think> block, hits
    # finish_reason="length" at 700 tokens, and message.content holds
    # only reasoning -> the old parser correctly reported "empty
    # vision response". Disable thinking via reasoning_effort="none"
    # (Groq honors it for qwen models through extra_body) so the
    # budget is spent on the JSON answer. Only qwen models receive
    # this field; other vision models must omit it.

    reasoning_effort = provider.get("reasoning_effort")
    model_lower = str(selected_model or "").lower()

    if reasoning_effort and "qwen" in model_lower:
        request_kwargs["extra_body"] = {
            "reasoning_effort": reasoning_effort,
        }

    print(
        "[VISION REQUEST]",
        f"provider={provider_id}",
        f"model={selected_model}",
        f"max_tokens={max_tokens}",
        f"vision_keys_loaded="
        f"groq={'yes' if bool(GROQ_API_KEY) else 'no'},"
        f"openrouter={'yes' if bool(OPENROUTER_API_KEY) else 'no'},"
        f"deepseek={'yes' if bool(DEEPSEEK_API_KEY) else 'no'}",
        f"image_bytes={len(image_bytes)}",
        f"content_type={content_type}",
    )

    try:
        response = client.chat.completions.create(
            **request_kwargs
        )
    except Exception as error:
        print(
            "[VISION PROVIDER ERROR]",
            f"provider={provider_id}",
            f"model={selected_model}",
            f"exception={type(error).__name__}",
            f"detail={get_error_text(error)}",
        )
        raise

    answer = extract_response_text(response)

    if not answer:
        # Bounded sanitized diagnostic: never logs keys or image data.
        try:
            choice = response.choices[0]
            finish = getattr(choice, "finish_reason", "?")
            msg = getattr(choice, "message", None)
            msg_keys = (
                list(msg.model_dump().keys())
                if hasattr(msg, "model_dump")
                else (
                    list(vars(msg).keys())
                    if hasattr(msg, "__dict__")
                    else ["?"]
                )
            )
            raw_content = getattr(msg, "content", None)
            ctype = type(raw_content).__name__
            clen = (
                len(raw_content)
                if isinstance(raw_content, (str, list))
                else -1
            )
            has_reasoning = bool(
                getattr(msg, "reasoning_content", None)
                or getattr(msg, "reasoning", None)
            )
            has_tools = bool(
                getattr(msg, "tool_calls", None)
                or getattr(msg, "function_call", None)
            )
            has_refusal = bool(getattr(msg, "refusal", None))
        except Exception:
            finish, msg_keys = "?", ["?"]
            ctype, clen = "?", -1
            has_reasoning = has_tools = has_refusal = False

        print(
            "[VISION EMPTY RESPONSE]",
            f"provider={provider_id}",
            f"model={selected_model}",
            f"choices={len(getattr(response, 'choices', []) or [])}",
            f"content_type={ctype}",
            f"content_length={clen}",
            f"finish_reason={finish}",
            f"message_keys={msg_keys}",
            f"reasoning_present={has_reasoning}",
            f"tool_calls_present={has_tools}",
            f"refusal_present={has_refusal}",
        )

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
    max_tokens: int = 700,
) -> dict[str, Any]:
    """
    Analyze an image using a vision-capable provider.

    The camera-specific output budget defaults to 700 tokens so Groq
    qwen/qwen3.8-27b accepts the request.

    Groq is the default because the configured Groq model supports
    image input. Other providers are used only when a vision model
    is explicitly configured for them.
    """

    # Refresh API clients so .env edits are picked up even when the
    # backend process was started before the keys were added.
    refresh_provider_clients()

    provider_order = build_vision_provider_order(provider)
    errors: list[dict[str, str]] = []
    attempted: list[str] = []

    for provider_id in provider_order:
        provider_config = get_provider(provider_id)

        if provider_config is None:
            continue

        if provider_config.get("client") is None:
            print(
                "[VISION SKIP]",
                f"provider={provider_id} reason=api_key_missing",
            )
            continue

        if not provider_config.get("supports_vision"):
            print(
                "[VISION SKIP]",
                f"provider={provider_id} reason=vision_not_supported",
            )
            continue

        if not provider_config.get("vision_model"):
            print(
                "[VISION SKIP]",
                f"provider={provider_id} reason=vision_model_missing",
            )
            continue

        selected_model = model

        # Use the requested model only for the preferred provider.
        if provider_id != provider and provider is not None:
            selected_model = None

        attempted.append(
            f"{provider_id}:"
            f"{selected_model or provider_config.get('vision_model')}"
        )

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
            error_text = get_error_text(error)
            errors.append(
                {
                    "provider": provider_id,
                    "error": error_text,
                }
            )

            print(
                "[VISION FALLBACK]",
                f"failed_provider={provider_id}",
                f"error={error_text}",
            )

            # Do not retry providers after auth failures; other
            # providers may still succeed with their own keys.
            continue

    if not attempted and not errors:
        raise VisionProviderError(
            "No vision-capable AI provider is configured. "
            "Set GROQ_API_KEY or OPENROUTER_API_KEY in the .env file.",
            error_code="AI_PROVIDER_NOT_CONFIGURED",
            provider_errors=[],
        )

    error_summary = "; ".join(
        f"{item['provider']}: {item['error']}"
        for item in errors
    )

    raise VisionProviderError(
        "All configured vision providers failed."
        + (f" Details: {error_summary}" if error_summary else ""),
        error_code=classify_provider_error(error_summary),
        provider_errors=errors,
    )


# =========================================================
# DEBUG INFORMATION
# =========================================================

def get_provider_debug_info() -> dict[str, Any]:
    """
    Return safe provider information without exposing API keys.
    """

    groq_reasoning_note = (
        "reasoning_effort is sent only for qwen vision models; "
        "non-qwen vision models omit the parameter."
    )

    return {
        "openrouter_key_loaded": bool(OPENROUTER_API_KEY),
        "groq_key_loaded": bool(GROQ_API_KEY),
        "deepseek_key_loaded": bool(DEEPSEEK_API_KEY),
        "groq_model": GROQ_MODEL,
        "groq_vision_model": GROQ_VISION_MODEL,
        "groq_reasoning_note": groq_reasoning_note,
        "openrouter_model": OPENROUTER_MODEL,
        "openrouter_vision_model": OPENROUTER_VISION_MODEL or None,
        "deepseek_model": DEEPSEEK_MODEL,
        "text_providers": get_available_providers(),
        "vision_providers": get_available_vision_providers(),
    }


class VisionProviderError(RuntimeError):
    """Raised when every configured vision provider fails."""

    def __init__(
        self,
        message: str,
        error_code: str = "VISION_PROVIDER_FAILED",
        provider_errors: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.provider_errors = provider_errors or []


def refresh_provider_clients() -> dict[str, Any]:
    """Re-read API keys and rebuild clients without logging secrets."""

    load_dotenv(override=False)

    global OPENROUTER_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY
    global GROQ_VISION_MODEL, OPENROUTER_VISION_MODEL
    global openrouter_client, groq_client, deepseek_client

    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
    GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
    DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
    GROQ_VISION_MODEL = os.getenv(
        "GROQ_VISION_MODEL", GROQ_VISION_MODEL
    )
    OPENROUTER_VISION_MODEL = os.getenv(
        "OPENROUTER_VISION_MODEL", OPENROUTER_VISION_MODEL
    ).strip()

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
    PROVIDERS["openrouter"]["client"] = openrouter_client
    PROVIDERS["openrouter"]["vision_model"] = (
        OPENROUTER_VISION_MODEL or None
    )
    PROVIDERS["openrouter"]["supports_text"] = (
        openrouter_client is not None
    )
    PROVIDERS["openrouter"]["supports_vision"] = (
        openrouter_client is not None
        and bool(OPENROUTER_VISION_MODEL)
    )
    PROVIDERS["groq"]["client"] = groq_client
    PROVIDERS["groq"]["vision_model"] = GROQ_VISION_MODEL
    PROVIDERS["groq"]["supports_text"] = groq_client is not None
    PROVIDERS["groq"]["supports_vision"] = groq_client is not None
    PROVIDERS["groq"]["reasoning_effort"] = os.getenv(
        "GROQ_REASONING_EFFORT",
        PROVIDERS["groq"].get("reasoning_effort", "none"),
    ).strip()
    PROVIDERS["deepseek"]["client"] = deepseek_client
    PROVIDERS["deepseek"]["supports_text"] = (
        deepseek_client is not None
    )
    return get_provider_debug_info()


def classify_provider_error(error_text: str) -> str:
    """Map provider error text to a stable error code."""

    lowered = (error_text or "").lower()

    if any(t in lowered for t in ("empty vision response", "empty response",
                                  "vision_empty_response")):
        return "VISION_EMPTY_RESPONSE"
    if any(t in lowered for t in ("not configured", "no vision")):
        return "AI_PROVIDER_NOT_CONFIGURED"
    if any(t in lowered for t in ("invalid api key", "incorrect api key",
                                  "unauthorized", "authentication",
                                  "http 401", "http 403")):
        return "AI_PROVIDER_AUTH_FAILED"
    if any(t in lowered for t in ("rate limit", "http 429",
                                  "too many requests", "quota",
                                  "insufficient", "credit", "billing")):
        return "AI_PROVIDER_RATE_LIMITED"
    if any(t in lowered for t in ("model_not_found", "model not found",
                                  "does not exist", "decommissioned",
                                  "http 404")):
        return "AI_MODEL_UNAVAILABLE"
    if "support" in lowered and "imag" in lowered:
        return "AI_MODEL_VISION_UNSUPPORTED"
    if any(t in lowered for t in ("timeout", "timed out", "connection",
                                  "network", "http 502", "http 503",
                                  "http 500", "overloaded")):
        return "AI_PROVIDER_UNAVAILABLE"
    return "VISION_PROVIDER_FAILED"