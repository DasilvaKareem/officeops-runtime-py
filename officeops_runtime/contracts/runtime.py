from typing import Literal

from pydantic import BaseModel, Field

from officeops_runtime.contracts.artifacts import RuntimeArtifact

DepartmentName = Literal[
    "lobby",
    "executive",
    "engineering",
    "marketing",
    "sales",
    "accounting",
    "hr",
    "operations",
    "custom",
]
IntegrationKey = Literal[
    "firebase_rtdb",
    "firebase_storage",
    "google_calendar",
    "gmail",
    "slack",
    "hubspot",
    "stripe",
    "vapi",
    "custom",
]
AgentRuntimeStatus = Literal["idle", "moving", "working", "waiting", "failed", "offline"]
ElevatorTransferStatus = Literal["queued", "moving", "arrived", "cancelled"]
RunStatus = Literal["running", "complete", "error", "cancelled"]
RouteMode = Literal["full", "plan_only", "review_only", "quick_fix"]


class FloorDefinition(BaseModel):
    id: int
    name: str
    department: DepartmentName
    description: str
    default_integrations: list[IntegrationKey]


class AgentCapability(BaseModel):
    key: str
    description: str
    integration: IntegrationKey | None = None


class AgentTemplate(BaseModel):
    id: str
    label: str
    role: str
    department: DepartmentName
    default_floor_id: int | None = None
    model_provider: str
    model_name: str
    system_prompt: str | None = None
    capabilities: list[AgentCapability] = Field(default_factory=list)
    default_tools: list[str] = Field(default_factory=list)
    metadata: dict[str, object] = Field(default_factory=dict)


class AgentInstance(BaseModel):
    id: str
    template_id: str
    label: str
    role: str
    home_floor_id: int
    current_floor_id: int
    status: AgentRuntimeStatus
    current_task: str | None = None
    enabled: bool = True
    integrations: list[IntegrationKey] = Field(default_factory=list)
    model_provider: str
    model_name: str
    created_at: int
    updated_at: int
    metadata: dict[str, object] = Field(default_factory=dict)


class AgentMessage(BaseModel):
    id: str
    text: str
    created_at: int
    kind: Literal["task", "handoff", "status", "human"]
    from_agent_id: str | None = None
    to_agent_id: str | None = None
    from_floor_id: int | None = None
    to_floor_id: int | None = None


class ElevatorTransfer(BaseModel):
    id: str
    agent_id: str
    from_floor_id: int
    to_floor_id: int
    reason: str
    status: ElevatorTransferStatus
    requested_at: int
    updated_at: int
    run_id: str | None = None


class RuntimeRun(BaseModel):
    id: str
    user_id: str
    floor_id: int
    prompt: str
    status: RunStatus
    started_at: int
    updated_at: int
    finished_at: int | None = None
    active_agent_ids: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    last_message: str | None = None


class CompanySnapshot(BaseModel):
    user_id: str
    floors: list[FloorDefinition]
    agent_templates: list[AgentTemplate]
    floor_agents: dict[int, list[AgentInstance]]
    active_runs: list[RuntimeRun]


class RuntimeLog(BaseModel):
    level: Literal["info", "warning", "error"]
    message: str
    at: int
    agent_id: str | None = None
    stage: str | None = None


class RuntimeRoute(BaseModel):
    mode: RouteMode
    reason: str


class RuntimeGraphState(BaseModel):
    run_id: str
    user_id: str
    floor_id: int
    prompt: str
    status: RunStatus
    route: RuntimeRoute | None = None
    company: CompanySnapshot | None = None
    requirements: str | None = None
    task_plan: str | None = None
    code_output: str | None = None
    review_output: str | None = None
    security_output: str | None = None
    testing_output: str | None = None
    deployment_output: str | None = None
    artifacts: list[RuntimeArtifact] = Field(default_factory=list)
    messages: list[AgentMessage] = Field(default_factory=list)
    transfer_requests: list[ElevatorTransfer] = Field(default_factory=list)
    active_agents: dict[str, AgentInstance] = Field(default_factory=dict)
    logs: list[RuntimeLog] = Field(default_factory=list)
    iteration_count: int = 0
    max_iterations: int = 3
    error: str | None = None


DEFAULT_FLOORS = [
    FloorDefinition(
        id=1,
        name="Lobby",
        department="lobby",
        description="Reception, routing, and Vapi voice concierge.",
        default_integrations=["vapi", "firebase_rtdb"],
    ),
    FloorDefinition(
        id=2,
        name="Human Resources",
        department="hr",
        description="Hiring, onboarding, and people ops.",
        default_integrations=["google_calendar", "gmail"],
    ),
    FloorDefinition(
        id=3,
        name="Accounting",
        department="accounting",
        description="Books, reconciliation, invoices, and finance ops.",
        default_integrations=["stripe", "gmail"],
    ),
    FloorDefinition(
        id=4,
        name="Engineering",
        department="engineering",
        description="Build, QA, deployment, and internal tools.",
        default_integrations=["firebase_rtdb", "firebase_storage"],
    ),
    FloorDefinition(
        id=5,
        name="Marketing",
        department="marketing",
        description="Campaigns, assets, and content production.",
        default_integrations=["google_calendar", "gmail"],
    ),
    FloorDefinition(
        id=6,
        name="Sales",
        department="sales",
        description="Pipeline, outreach, meetings, and revenue operations.",
        default_integrations=["google_calendar", "hubspot", "gmail"],
    ),
    FloorDefinition(
        id=7,
        name="Executive Floor",
        department="executive",
        description="Leadership, cross-floor coordination, and approvals.",
        default_integrations=["google_calendar", "slack"],
    ),
]
