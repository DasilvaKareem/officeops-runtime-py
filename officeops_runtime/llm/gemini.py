import json
import urllib.error
import urllib.request
from typing import Any

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
    api_key = settings.gemini_api_key or settings.google_api_key
    if not api_key:
        raise GeminiError("Missing GEMINI_API_KEY or GOOGLE_API_KEY")

    model_name = settings.default_model_name or "gemini-2.5-pro"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={api_key}"
    )

    body: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
        },
    }

    if system_instruction:
        body["systemInstruction"] = {
            "parts": [{"text": system_instruction}],
        }
    if response_mime_type:
        body["generationConfig"]["responseMimeType"] = response_mime_type

    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise GeminiError(f"Gemini request failed ({error.code}): {details}") from error
    except urllib.error.URLError as error:
        raise GeminiError(f"Gemini request failed: {error.reason}") from error

    candidates = payload.get("candidates") or []
    if not candidates:
        raise GeminiError(f"Gemini returned no candidates: {payload}")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise GeminiError(f"Gemini returned empty text: {payload}")
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
