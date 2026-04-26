# OfficeOps Runtime Python

Clean Python backend for OfficeOps using LangGraph.

This service is intended to replace the old hackathon orchestrator while preserving the frontend contract:

- `POST /api/orchestrate`
- SSE event streaming
- Firebase RTDB live runtime state
- Firebase Storage artifact persistence

## Product assumptions baked into this backend

- There are seven floors.
- Agents are dynamic and user-creatable.
- Floors host department-specific agents like lobby, sales, marketing, accounting, engineering, HR, and executive.
- Agents can move across floors through persisted elevator transfers.
- Every meaningful run should save artifacts.

## Initial scaffold includes

- FastAPI app
- LangGraph-ready runtime state
- dynamic floor and agent models
- Firebase admin adapters
- artifact persistence skeleton
- elevator transfer persistence skeleton
- SSE route contract compatible with OfficeOps

## Gemini auth

The runtime uses Vertex AI through the Google Gen AI SDK with Application Default
Credentials. On Cloud Run this means the attached service account is used
directly; no `GEMINI_API_KEY` or `GOOGLE_API_KEY` secret is required.

Required environment:

- `GOOGLE_CLOUD_PROJECT=customspro-bd062`
- `GOOGLE_CLOUD_LOCATION=global`
- `GOOGLE_GENAI_USE_VERTEXAI=true`
- `DEFAULT_MODEL_NAME=gemini-3-flash-preview`

## Next implementation passes

1. connect real model providers and agent executors
2. expand graph nodes for planning, review loops, security, testing, and deployment
3. add cancellation and checkpoint persistence
4. point the existing OfficeOps proxy at this service
