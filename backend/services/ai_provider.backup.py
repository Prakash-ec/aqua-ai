import os

from dotenv import load_dotenv
from openai import OpenAI


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


if GROQ_API_KEY:
    groq_client = OpenAI(
        api_key=GROQ_API_KEY,
        base_url="https://api.groq.com/openai/v1",
    )


if DEEPSEEK_API_KEY:
    deepseek_client = OpenAI(
        api_key=DEEPSEEK_API_KEY,
        base_url="https://api.deepseek.com",
    )


# =========================================================
# MODELS
# =========================================================

OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"

GROQ_MODEL = "openai/gpt-oss-20b"

DEEPSEEK_MODEL = "deepseek-chat"


# =========================================================
# SINGLE PROVIDER CALL
# =========================================================

def call_provider(
    provider,
    client,
    model,
    system_prompt,
    user_content,
):

    print("")
    print("----------------------------------------")
    print(f"TRYING AI PROVIDER: {provider}")
    print(f"MODEL: {model}")
    print("----------------------------------------")

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
        max_tokens=300,
    )

    answer = response.choices[0].message.content

    if not answer:
        raise RuntimeError(
            f"{provider} returned an empty response."
        )

    print(f"{provider} SUCCESS")

    return answer.strip(), model


# =========================================================
# FALLBACK MANAGER
# =========================================================

def ask_ai(
    system_prompt,
    user_content,
):

    providers = []

    # -----------------------------------------------------
    # 1. OPENROUTER
    # -----------------------------------------------------

    if openrouter_client:

        providers.append(
            (
                "OpenRouter",
                openrouter_client,
                OPENROUTER_MODEL,
            )
        )

    # -----------------------------------------------------
    # 2. GROQ
    # -----------------------------------------------------

    if groq_client:

        providers.append(
            (
                "Groq",
                groq_client,
                GROQ_MODEL,
            )
        )

    # -----------------------------------------------------
    # 3. DEEPSEEK
    # -----------------------------------------------------

    if deepseek_client:

        providers.append(
            (
                "DeepSeek",
                deepseek_client,
                DEEPSEEK_MODEL,
            )
        )

    # -----------------------------------------------------
    # NO PROVIDERS
    # -----------------------------------------------------

    if not providers:

        raise RuntimeError(
            "No AI providers are configured. "
            "Please configure at least one of: "
            "OPENROUTER_API_KEY, GROQ_API_KEY, "
            "DEEPSEEK_API_KEY."
        )

    errors = []

    # =====================================================
    # TRY PROVIDERS
    # =====================================================

    for provider_name, client, model in providers:

        try:

            return call_provider(
                provider=provider_name,
                client=client,
                model=model,
                system_prompt=system_prompt,
                user_content=user_content,
            )

        except Exception as e:

            error_message = str(e)

            print("")
            print(f"{provider_name} FAILED")
            print(error_message)
            print("")

            errors.append(
                f"{provider_name}: {error_message}"
            )

            # Continue to next provider.
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
        "All configured AI providers are currently "
        "unavailable."
    )