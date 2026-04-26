from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from officeops_runtime.contracts.runtime import AgentAssetOverrides, AgentTemplate, UserAsset
from officeops_runtime.firebase.artifact_store import persist_user_asset_upload
from officeops_runtime.firebase.company_runtime import (
    append_agent_conversation_messages,
    clear_agent_conversation,
    create_agent_instance,
    get_agent_instance,
    load_agent_conversation,
    load_company_snapshot,
    save_agent_template,
    save_user_asset,
    update_agent_instance_assets,
)
from officeops_runtime.llm.gemini import GeminiError, generate_text
from officeops_runtime.llm.prompts import ASSISTANT_SYSTEM_PROMPT
from officeops_runtime.server.sse import build_failure_stream, build_success_stream
from officeops_runtime.services.runtime_service import run_runtime_graph
from officeops_runtime.utils.time import now_ms

app = FastAPI(title="OfficeOps Runtime Python")


def _apply_asset_binding(
    user_id: str,
    agent_id: str | None,
    slot: str | None,
    asset_id: str,
):
    if not agent_id or not slot:
        return None

    field_map = {
        "model": "model_asset_id",
        "voice": "voice_asset_id",
        "workspace": "workspace_asset_id",
    }
    target_field = field_map.get(slot)
    if target_field is None:
        return None

    overrides = AgentAssetOverrides(**{target_field: asset_id})
    return update_agent_instance_assets(
        user_id,
        agent_id=agent_id,
        asset_overrides=overrides,
    )


class OrchestrateRequest(BaseModel):
    user_id: str | None = None
    userId: str | None = None
    floor_id: int | None = Field(default=None, ge=1, le=7)
    floorId: int | None = Field(default=None, ge=1, le=7)
    prompt: str | None = None
    requirement: str | None = None

    @model_validator(mode="after")
    def normalize(self) -> "OrchestrateRequest":
        user_id = self.user_id or self.userId
        prompt = self.prompt or self.requirement
        floor_id = self.floor_id or self.floorId or 7
        if not user_id:
            raise ValueError("user_id or userId is required")
        if not prompt or not prompt.strip():
            raise ValueError("prompt or requirement is required")
        self.user_id = user_id
        self.prompt = prompt
        self.floor_id = floor_id
        return self


class AgentTemplateCreateRequest(BaseModel):
    user_id: str
    template: AgentTemplate


class AgentInstanceCreateRequest(BaseModel):
    user_id: str
    template_id: str
    floor_id: int | None = Field(default=None, ge=1, le=7)
    label: str | None = None
    asset_overrides: AgentAssetOverrides = Field(default_factory=AgentAssetOverrides)


class AssetRegisterRequest(BaseModel):
    user_id: str
    asset: UserAsset


class AgentAssetUpdateRequest(BaseModel):
    user_id: str
    asset_overrides: AgentAssetOverrides


class AgentConversationRequest(BaseModel):
    user_id: str | None = None
    userId: str | None = None
    message: str
    max_history: int = Field(default=20, ge=1, le=100)

    @model_validator(mode="after")
    def normalize(self) -> "AgentConversationRequest":
        user_id = self.user_id or self.userId
        if not user_id:
            raise ValueError("user_id or userId is required")
        if not self.message or not self.message.strip():
            raise ValueError("message is required")
        self.user_id = user_id
        self.message = self.message.strip()
        return self


def _build_conversation_prompt(
    *,
    agent_label: str,
    agent_role: str,
    history: list[dict[str, object]],
    user_message: str,
) -> str:
    history_lines: list[str] = []
    for item in history[-20:]:
        role = str(item.get("role") or "assistant").upper()
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        history_lines.append(f"{role}: {text}")

    transcript = "\n".join(history_lines) if history_lines else "(no prior messages)"
    return (
        f"You are in a 1:1 chat as office agent '{agent_label}' ({agent_role}).\n"
        f"Conversation history:\n{transcript}\n\n"
        f"USER: {user_message}\n"
        "ASSISTANT:"
    )


@app.get("/health")
def health():
    return {"ok": True, "service": "officeops-runtime-py"}


@app.get("/api/company/{user_id}")
def get_company(user_id: str):
    snapshot = load_company_snapshot(user_id)
    return snapshot.model_dump()


@app.post("/api/agents/templates")
def create_template(request: AgentTemplateCreateRequest):
    save_agent_template(request.user_id, request.template)
    return {"ok": True, "template": request.template.model_dump()}


@app.post("/api/agents/instances")
def create_instance(request: AgentInstanceCreateRequest):
    snapshot = load_company_snapshot(request.user_id)
    template = next(
        (candidate for candidate in snapshot.agent_templates if candidate.id == request.template_id),
        None,
    )
    if template is None:
        return {"ok": False, "error": f"Template {request.template_id} not found"}
    instance = create_agent_instance(
        request.user_id,
        template=template,
        floor_id=request.floor_id,
        label=request.label,
        asset_overrides=request.asset_overrides,
    )
    return {"ok": True, "agent": instance.model_dump()}


@app.post("/api/assets/register")
def register_asset(request: AssetRegisterRequest):
    if request.asset.owner_uid != request.user_id:
        return {"ok": False, "error": "asset.owner_uid must match user_id"}
    save_user_asset(request.user_id, request.asset)
    return {"ok": True, "asset": request.asset.model_dump()}


@app.post("/api/assets/upload")
async def upload_asset(
    user_id: str = Form(...),
    kind: str = Form(...),
    file: UploadFile = File(...),
    agent_id: str | None = Form(default=None),
    slot: str | None = Form(default=None),
):
    allowed_kinds = {"model", "texture", "voice", "workspace", "image", "video", "audio", "document", "other"}
    allowed_slots = {None, "model", "voice", "workspace"}
    if kind not in allowed_kinds:
        raise HTTPException(status_code=400, detail=f"Unsupported asset kind: {kind}")
    if slot not in allowed_slots:
        raise HTTPException(status_code=400, detail=f"Unsupported asset slot: {slot}")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    asset = persist_user_asset_upload(
        user_id=user_id,
        kind=kind,
        file_name=file.filename or "upload.bin",
        content_type=file.content_type or "application/octet-stream",
        payload=payload,
        metadata={
            "uploaded_via": "api",
            "bound_agent_id": agent_id,
            "slot": slot,
        },
    )
    save_user_asset(user_id, asset)
    updated_agent = _apply_asset_binding(user_id, agent_id, slot, asset.id)
    response = {"ok": True, "asset": asset.model_dump()}
    if updated_agent is not None:
        response["agent"] = updated_agent.model_dump()
    return response


@app.patch("/api/agents/{agent_id}/assets")
def update_agent_assets(agent_id: str, request: AgentAssetUpdateRequest):
    updated_agent = update_agent_instance_assets(
        request.user_id,
        agent_id=agent_id,
        asset_overrides=request.asset_overrides,
    )
    if updated_agent is None:
        return {"ok": False, "error": f"Agent {agent_id} not found"}
    return {"ok": True, "agent": updated_agent.model_dump()}


@app.get("/api/agents/{agent_id}/conversation")
def get_agent_conversation(
    agent_id: str,
    user_id: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
):
    agent = get_agent_instance(user_id, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    messages = load_agent_conversation(user_id, agent_id, limit=limit)
    return {"ok": True, "agent": agent.model_dump(), "messages": messages}


@app.post("/api/agents/{agent_id}/conversation")
def send_agent_conversation_message(agent_id: str, request: AgentConversationRequest):
    agent = get_agent_instance(request.user_id, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    history = load_agent_conversation(request.user_id, agent_id, limit=request.max_history)
    prompt = _build_conversation_prompt(
        agent_label=agent.label,
        agent_role=agent.role,
        history=history,
        user_message=request.message,
    )
    system_instruction = (
        ASSISTANT_SYSTEM_PROMPT
        + "\nStay in character as the selected office agent. Use concise, practical replies."
    )

    try:
        reply = generate_text(prompt=prompt, system_instruction=system_instruction, temperature=0.35)
    except GeminiError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    ts = now_ms()
    append_agent_conversation_messages(
        request.user_id,
        agent_id,
        [
            {"role": "user", "text": request.message, "created_at": ts},
            {"role": "assistant", "text": reply, "created_at": now_ms()},
        ],
    )
    messages = load_agent_conversation(request.user_id, agent_id, limit=request.max_history)
    return {"ok": True, "agent": agent.model_dump(), "reply": reply, "messages": messages}


@app.delete("/api/agents/{agent_id}/conversation")
def reset_agent_conversation(agent_id: str, user_id: str = Query(..., min_length=1)):
    agent = get_agent_instance(user_id, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    clear_agent_conversation(user_id, agent_id)
    return {"ok": True, "agent_id": agent_id}


@app.post("/api/orchestrate")
async def orchestrate(request: OrchestrateRequest):
    try:
        final_state = run_runtime_graph(
            user_id=request.user_id,
            floor_id=request.floor_id,
            prompt=request.prompt,
        )
        return StreamingResponse(build_success_stream(final_state), media_type="text/event-stream")
    except Exception as error:  # noqa: BLE001
        return StreamingResponse(
            build_failure_stream("unknown", str(error)),
            media_type="text/event-stream",
            status_code=500,
        )
