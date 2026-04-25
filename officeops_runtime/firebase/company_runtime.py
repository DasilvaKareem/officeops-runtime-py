from officeops_runtime.contracts.artifacts import RuntimeArtifact
from officeops_runtime.contracts.runtime import (
    AgentCapability,
    AgentInstance,
    AgentTemplate,
    CompanySnapshot,
    DEFAULT_FLOORS,
    ElevatorTransfer,
    RuntimeRun,
)
from officeops_runtime.firebase.admin import rtdb
from officeops_runtime.utils.ids import create_id
from officeops_runtime.utils.time import now_ms


def _company_path(user_id: str) -> str:
    return f"users/{user_id}/company"


def _default_agent_templates() -> list[AgentTemplate]:
    return [
        AgentTemplate(
            id="tmpl_lobby_concierge",
            label="Lobby Concierge",
            role="concierge",
            department="lobby",
            default_floor_id=1,
            model_provider="openai",
            model_name="gpt-4.1",
            capabilities=[
                AgentCapability(key="visitor-routing", description="Route incoming visitors and calls."),
                AgentCapability(key="voice-reception", description="Handle Vapi lobby intake.", integration="vapi"),
            ],
            default_tools=["voice_router", "calendar_lookup"],
        ),
        AgentTemplate(
            id="tmpl_exec_router",
            label="Executive Router",
            role="router",
            department="executive",
            default_floor_id=7,
            model_provider="openai",
            model_name="gpt-4.1",
            capabilities=[
                AgentCapability(key="cross-floor-routing", description="Coordinate tasks across floors."),
            ],
            default_tools=["task_router", "floor_dispatch"],
        ),
        AgentTemplate(
            id="tmpl_engineering_builder",
            label="Engineering Builder",
            role="builder",
            department="engineering",
            default_floor_id=4,
            model_provider="openai",
            model_name="gpt-4.1",
            capabilities=[
                AgentCapability(key="build-artifacts", description="Generate code and deployable outputs."),
            ],
            default_tools=["artifact_writer", "code_executor"],
        ),
        AgentTemplate(
            id="tmpl_sales_operator",
            label="Sales Operator",
            role="sales-operator",
            department="sales",
            default_floor_id=6,
            model_provider="openai",
            model_name="gpt-4.1",
            capabilities=[
                AgentCapability(key="meeting-ops", description="Coordinate outreach and meetings.", integration="google_calendar"),
            ],
            default_tools=["crm_sync", "calendar_scheduler"],
        ),
        AgentTemplate(
            id="tmpl_marketing_producer",
            label="Marketing Producer",
            role="campaign-producer",
            department="marketing",
            default_floor_id=5,
            model_provider="openai",
            model_name="gpt-4.1",
            capabilities=[
                AgentCapability(key="campaign-assets", description="Create campaign drafts and assets."),
            ],
            default_tools=["asset_writer", "content_planner"],
        ),
        AgentTemplate(
            id="tmpl_accounting_controller",
            label="Accounting Controller",
            role="controller",
            department="accounting",
            default_floor_id=3,
            model_provider="openai",
            model_name="gpt-4.1",
            capabilities=[
                AgentCapability(key="finance-ops", description="Track books, invoices, and reconciliation."),
            ],
            default_tools=["ledger_writer", "invoice_helper"],
        ),
    ]


def _build_default_agent_instances(templates: list[AgentTemplate]) -> dict[str, dict[str, object]]:
    agents_by_floor: dict[str, dict[str, object]] = {str(floor.id): {} for floor in DEFAULT_FLOORS}

    for template in templates:
        timestamp = now_ms()
        floor_id = template.default_floor_id or 7
        instance = AgentInstance(
            id=f"seed_{template.id}",
            template_id=template.id,
            label=template.label,
            role=template.role,
            home_floor_id=floor_id,
            current_floor_id=floor_id,
            status="idle",
            current_task=None,
            enabled=True,
            integrations=[
                capability.integration
                for capability in template.capabilities
                if capability.integration is not None
            ],
            model_provider=template.model_provider,
            model_name=template.model_name,
            created_at=timestamp,
            updated_at=timestamp,
            metadata={"seeded": True, **template.metadata},
        )
        agents_by_floor[str(floor_id)][instance.id] = instance.model_dump()

    return agents_by_floor


def load_company_snapshot(user_id: str) -> CompanySnapshot:
    value = rtdb.reference(_company_path(user_id)).get() or {}
    floors_value = value.get("floors", {})
    floor_agents: dict[int, list[AgentInstance]] = {}

    for floor in DEFAULT_FLOORS:
        floor_agents[floor.id] = _parse_floor_agents(floors_value.get(str(floor.id), {}).get("agents", {}))

    templates_raw = value.get("agentTemplates") or []
    templates = (
        [AgentTemplate.model_validate(item) for item in templates_raw]
        if templates_raw
        else _default_agent_templates()
    )

    if not value.get("agentTemplates"):
        bootstrap_company(user_id, templates)
        value = rtdb.reference(_company_path(user_id)).get() or {}
        floors_value = value.get("floors", {})
        floor_agents = {}
        for floor in DEFAULT_FLOORS:
            floor_agents[floor.id] = _parse_floor_agents(floors_value.get(str(floor.id), {}).get("agents", {}))
        templates = [AgentTemplate.model_validate(item) for item in (value.get("agentTemplates", {}) or {}).values()] or templates

    return CompanySnapshot(
        user_id=user_id,
        floors=DEFAULT_FLOORS,
        agent_templates=templates,
        floor_agents=floor_agents,
        active_runs=[
            RuntimeRun.model_validate(item)
            for item in (value.get("runs", {}) or {}).values()
        ],
    )


def _parse_floor_agents(raw_agents: object) -> list[AgentInstance]:
    if isinstance(raw_agents, dict):
        return [AgentInstance.model_validate(item) for item in raw_agents.values()]
    if isinstance(raw_agents, list):
        return [AgentInstance.model_validate(item) for item in raw_agents]
    return []


def bootstrap_company(user_id: str, templates: list[AgentTemplate] | None = None) -> None:
    seed_templates = templates or _default_agent_templates()
    seeded_agents = _build_default_agent_instances(seed_templates)
    base_ref = rtdb.reference(_company_path(user_id))
    payload: dict[str, object] = {
        "floors": {
            str(floor.id): {
                "definition": floor.model_dump(),
                "agents": seeded_agents.get(str(floor.id), {}),
            }
            for floor in DEFAULT_FLOORS
        },
        "agentTemplates": {template.id: template.model_dump() for template in seed_templates},
    }
    base_ref.update(payload)


def save_run(user_id: str, run: RuntimeRun) -> None:
    base = _company_path(user_id)
    rtdb.reference(f"{base}/runs/{run.id}").set(run.model_dump())
    rtdb.reference(f"{base}/floors/{run.floor_id}/runs/{run.id}").set(run.model_dump())


def save_transfer(user_id: str, transfer: ElevatorTransfer) -> None:
    rtdb.reference(f"{_company_path(user_id)}/elevator/transfers/{transfer.id}").set(
        transfer.model_dump()
    )


def save_artifacts(user_id: str, run_id: str, artifacts: list[RuntimeArtifact]) -> None:
    base = _company_path(user_id)
    for artifact in artifacts:
        if not artifact.id:
            continue
        rtdb.reference(f"{base}/artifacts/byId/{artifact.id}").set(artifact.model_dump())
        rtdb.reference(f"{base}/artifacts/byRun/{run_id}/{artifact.id}").set(artifact.model_dump())


def save_agent_template(user_id: str, template: AgentTemplate) -> None:
    rtdb.reference(f"{_company_path(user_id)}/agentTemplates/{template.id}").set(template.model_dump())


def create_agent_instance(
    user_id: str,
    template: AgentTemplate,
    floor_id: int | None = None,
    label: str | None = None,
) -> AgentInstance:
    timestamp = now_ms()
    instance = AgentInstance(
        id=create_id("agent"),
        template_id=template.id,
        label=label or template.label,
        role=template.role,
        home_floor_id=floor_id or template.default_floor_id or 7,
        current_floor_id=floor_id or template.default_floor_id or 7,
        status="idle",
        current_task=None,
        enabled=True,
        integrations=[
            capability.integration
            for capability in template.capabilities
            if capability.integration is not None
        ],
        model_provider=template.model_provider,
        model_name=template.model_name,
        created_at=timestamp,
        updated_at=timestamp,
        metadata=template.metadata,
    )
    rtdb.reference(
        f"{_company_path(user_id)}/floors/{instance.current_floor_id}/agents/{instance.id}"
    ).set(instance.model_dump())
    return instance
