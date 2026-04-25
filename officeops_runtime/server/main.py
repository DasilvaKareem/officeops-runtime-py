from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from officeops_runtime.contracts.runtime import AgentTemplate
from officeops_runtime.firebase.company_runtime import (
    create_agent_instance,
    load_company_snapshot,
    save_agent_template,
)
from officeops_runtime.server.sse import build_failure_stream, build_success_stream
from officeops_runtime.services.runtime_service import run_runtime_graph

app = FastAPI(title="OfficeOps Runtime Python")


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
    )
    return {"ok": True, "agent": instance.model_dump()}


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
