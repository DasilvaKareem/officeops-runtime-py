import json
from typing import Any

from google import genai
from google.genai import errors, types

from officeops_runtime.config import settings


class GeminiError(RuntimeError):
    """Raised when the Gemini API request fails."""


def generate_text(
    *,
    prompt: str,
    system_instruction: str | None = None,
    temperature: float = 0.3,
    response_mime_type: str | None = None,
) -> str:
    model_name = settings.default_model_name or "gemini-3-flash-preview"
    if not model_name.lower().startswith("gemini-"):
        model_name = "gemini-3-flash-preview"

    project = settings.google_cloud_project or settings.firebase_project_id
    if not project:
        raise GeminiError("Missing GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID")

    client = genai.Client(
        vertexai=settings.google_genai_use_vertexai,
        project=project,
        location=settings.google_cloud_location,
    )

    config = types.GenerateContentConfig(
        temperature=temperature,
        response_mime_type=response_mime_type,
        system_instruction=system_instruction,
    )
    if response_mime_type:
        config.response_mime_type = response_mime_type

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=config,
        )
    except errors.APIError as error:
        raise GeminiError(f"Gemini request failed ({error.code}): {error.message}") from error
    except Exception as error:
        raise GeminiError(f"Gemini request failed: {error}") from error

    text = (response.text or "").strip()
    if not text:
        raise GeminiError(f"Gemini returned empty text: {response.model_dump_json()}")
    return text


def generate_json(*, prompt: str, system_instruction: str | None = None) -> dict[str, Any]:
    text = generate_text(
        prompt=prompt,
        system_instruction=system_instruction,
        temperature=0.2,
        response_mime_type="application/json",
    )
    return json.loads(strip_json_fence(text))


def strip_json_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            text = "\n".join(lines[1:-1]).strip()
    return text
