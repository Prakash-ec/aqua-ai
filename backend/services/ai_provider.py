import os
from dotenv import load_dotenv
from openai import OpenAI


# =========================================================
# LOAD ENVIRONMENT
# =========================================================

load_dotenv()


# =========================================================
# API KEYS
# =========================================================

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")


# =========================================================
# CLIENTS
# =========================================================

openrouter_client = None
groq_client = None
deepseek_client = None


if OPENROUTER_API_KEY:
    openrouter_client = OpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url="https://openrouter.ai/api/v1",
    )
    print("OPENROUTER_API_KEY loaded successfully")


if GROQ_API_KEY:
    groq_client = OpenAI(
        api_key=GROQ_API_KEY,
        base_url="https://api.groq.com/openai/v1",
    )
    print("GROQ_API_KEY loaded successfully")


if DEEPSEEK_API_KEY:
    deepseek_client = OpenAI(
        api_key=DEEPSEEK_API_KEY,
        base_url="https://api.deepseek.com",
    )
    print("DEEPSEEK_API_KEY loaded successfully")


# =========================================================
# MODELS
# =========================================================

OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"

GROQ_MODEL = "openai/gpt-oss-20b"

DEEPSEEK_MODEL = "deepseek-chat"


# =========================================================
# PROVIDERS
# =========================================================

PROVIDERS = {

    "groq": {
        "id": "groq",
        "name": "Groq",
        "client": groq_client,
        "model": GROQ_MODEL,
    },

    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "client": deepseek_client,
        "model": DEEPSEEK_MODEL,
    },

    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter",
        "client": openrouter_client,
        "model": OPENROUTER_MODEL,
    },
}


# =========================================================
# PROVIDER STATUS
# =========================================================

def get_available_providers():

    available = []

    for provider_id, config in PROVIDERS.items():

        if config["client"] is not None:

            available.append({
                "id": config["id"],
                "name": config["name"],
                "model": config["model"],
            })

    return available


# =========================================================
# GET PROVIDER
# =========================================================

def get_provider(provider_id):

    if not provider_id:
        return None

    return PROVIDERS.get(
        provider_id.lower().strip()
    )


# =========================================================
# DETECT PROVIDER LIMIT / QUOTA ERROR
# =========================================================

def is_provider_limit_error(error):

    message = str(error).lower()

    # HTTP status
    status_code = getattr(
        error,
        "status_code",
        None
    )

    if status_code == 429:
        return True

    # Common rate-limit / quota messages
    keywords = [

        "429",
        "rate limit",
        "rate_limit",
        "ratelimit",

        "quota",
        "quota exceeded",
        "quota_exceeded",

        "too many requests",

        "credits",
        "credit limit",
        "insufficient credits",

        "free-models-per-day",
        "free model",

        "daily limit",
        "daily quota",

        "tokens limit",
        "token limit",

        "limit exceeded",

        "resource exhausted",

    ]

    for keyword in keywords:

        if keyword in message:
            return True

    return False


# =========================================================
# DETECT TEMPORARY PROVIDER ERROR
# =========================================================

def is_retryable_error(error):

    message = str(error).lower()

    status_code = getattr(
        error,
        "status_code",
        None
    )

    # Rate limit
    if status_code == 429:
        return True

    # Server errors
    if status_code in [500, 502, 503, 504]:
        return True

    keywords = [

        "timeout",
        "timed out",

        "connection error",
        "connection reset",

        "temporarily unavailable",

        "service unavailable",

        "internal server error",

        "bad gateway",

        "gateway timeout",

        "rate limit",
        "quota",

        "credits",

        "too many requests",

        "resource exhausted",

    ]

    for keyword in keywords:

        if keyword in message:
            return True

    return False


# =========================================================
# CALL SINGLE PROVIDER
# =========================================================

def call_provider(
    provider,
    client,
    model,
    system_prompt,
    user_content,
):

    print("")
    print("========================================")
    print("TRYING AI PROVIDER")
    print("PROVIDER:", provider)
    print("MODEL:", model)
    print("========================================")

    if client is None:

        raise RuntimeError(
            f"{provider} is not configured."
        )

    response = client.chat.completions.create(

        model=model,

        messages=[
            {
                "role": "system",
                "content": system_prompt,
            },

            {
                "role": "user",
                "content": user_content,
            },
        ],

        temperature=0.2,

        max_tokens=500,
    )

    if not response.choices:

        raise RuntimeError(
            f"{provider} returned no choices."
        )

    answer = (
        response
        .choices[0]
        .message
        .content
    )

    if not answer:

        raise RuntimeError(
            f"{provider} returned an empty response."
        )

    print("")
    print("AI PROVIDER SUCCESS")
    print("PROVIDER:", provider)
    print("MODEL:", model)
    print("========================================")

    return answer.strip(), model


# =========================================================
# MAIN AI FUNCTION
# =========================================================

def ask_ai(
    system_prompt,
    user_content,
    selected_provider=None,
):

    # =====================================================
    # PROVIDER ORDER
    # =====================================================

    provider_order = []

    # -----------------------------------------------------
    # User-selected provider first
    # -----------------------------------------------------

    if selected_provider:

        selected_provider = (
            selected_provider
            .lower()
            .strip()
        )

        if selected_provider in PROVIDERS:

            provider_order.append(
                selected_provider
            )

    # -----------------------------------------------------
    # Automatic fallback order
    # -----------------------------------------------------

    fallback_order = [

        "groq",

        "deepseek",

        "openrouter",

    ]

    for provider_id in fallback_order:

        if provider_id not in provider_order:

            provider_order.append(
                provider_id
            )

    # =====================================================
    # LOG PROVIDER ORDER
    # =====================================================

    print("")
    print("========================================")
    print("AQUA AI PROVIDER ROUTER")
    print("========================================")
    print(
        "Provider order:",
        " -> ".join(provider_order)
    )
    print("========================================")

    # =====================================================
    # ERRORS
    # =====================================================

    errors = []

    # =====================================================
    # TRY PROVIDERS
    # =====================================================

    for provider_id in provider_order:

        config = PROVIDERS[provider_id]

        client = config["client"]

        model = config["model"]

        provider_name = config["name"]

        # -------------------------------------------------
        # Skip unavailable provider
        # -------------------------------------------------

        if client is None:

            print(
                f"SKIPPING {provider_name}: "
                "API key not configured."
            )

            continue

        # -------------------------------------------------
        # Try provider
        # -------------------------------------------------

        try:

            result = call_provider(

                provider=provider_name,

                client=client,

                model=model,

                system_prompt=system_prompt,

                user_content=user_content,

            )

            # -------------------------------------------------
            # SUCCESS
            # -------------------------------------------------

            print("")
            print("========================================")
            print("AQUA AI RESPONSE SUCCESS")
            print("PROVIDER:", provider_name)
            print("MODEL:", model)
            print("========================================")

            return result

        except Exception as e:

            error_message = str(e)

            errors.append(
                f"{provider_name}: {error_message}"
            )

            # =============================================
            # LIMIT / QUOTA
            # =============================================

            if is_provider_limit_error(e):

                print("")
                print("========================================")
                print("PROVIDER LIMIT REACHED")
                print("PROVIDER:", provider_name)
                print("MODEL:", model)
                print("ACTION: SWITCHING PROVIDER")
                print("========================================")

                continue

            # =============================================
            # TEMPORARY ERROR
            # =============================================

            if is_retryable_error(e):

                print("")
                print("========================================")
                print("TEMPORARY PROVIDER ERROR")
                print("PROVIDER:", provider_name)
                print("MODEL:", model)
                print("ACTION: SWITCHING PROVIDER")
                print("========================================")

                continue

            # =============================================
            # OTHER ERROR
            # =============================================

            print("")
            print("========================================")
            print("AI PROVIDER FAILED")
            print("PROVIDER:", provider_name)
            print("MODEL:", model)
            print("ERROR:", error_message)
            print("ACTION: TRYING NEXT PROVIDER")
            print("========================================")

            continue

    # =====================================================
    # ALL PROVIDERS FAILED
    # =====================================================

    print("")
    print("========================================")
    print("ALL AI PROVIDERS FAILED")
    print("========================================")

    for error in errors:

        print(error)

    print("========================================")

    raise RuntimeError(
        "All configured AI providers are currently unavailable."
    )