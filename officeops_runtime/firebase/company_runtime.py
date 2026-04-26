from typing import Any

from officeops_runtime.contracts.artifacts import RuntimeArtifact
from officeops_runtime.contracts.runtime import (
    AgentCapability,
    AgentAssetDefaults,
    AgentAssetOverrides,
    AgentInstance,
    AgentTemplate,
    CompanySnapshot,
    DEFAULT_FLOORS,
    ElevatorTransfer,
    RuntimeRun,
    UserAsset,
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
            model_provider="gemini",
            model_name="gemini-3-flash-preview",
            capabilities=[
                AgentCapability(key="visitor-routing", description="Route incoming visitors and calls."),
                AgentCapability(key="voice-reception", description="Handle Vapi lobby intake.", integration="vapi"),
            ],
            default_tools=["voice_router", "calendar_lookup"],
            default_assets=AgentAssetDefaults(
                model_bundle_id="core.agent.lobby.v1",
                voice_bundle_id="core.voice.lobby.v1",
                workspace_bundle_id="core.workspace.lobby.v1",
            ),
        ),
        AgentTemplate(
            id="tmpl_exec_router",
            label="Executive Router",
            role="router",
            department="executive",
            default_floor_id=7,
            model_provider="gemini",
            model_name="gemini-3-flash-preview",
            capabilities=[
                AgentCapability(key="cross-floor-routing", description="Coordinate tasks across floors."),
            ],
            default_tools=["task_router", "floor_dispatch"],
            default_assets=AgentAssetDefaults(
                model_bundle_id="core.agent.executive.v1",
                voice_bundle_id="core.voice.executive.v1",
                workspace_bundle_id="core.workspace.executive.v1",
            ),
        ),
        AgentTemplate(
            id="tmpl_engineering_builder",
            label="Engineering Builder",
            role="builder",
            department="engineering",
            default_floor_id=4,
            model_provider="gemini",
            model_name="gemini-3-flash-preview",
            capabilities=[
                AgentCapability(key="build-artifacts", description="Generate code and deployable outputs."),
            ],
            default_tools=["artifact_writer", "code_executor"],
            default_assets=AgentAssetDefaults(
                model_bundle_id="core.agent.engineering.v1",
                voice_bundle_id="core.voice.engineering.v1",
                workspace_bundle_id="core.workspace.engineering.v1",
            ),
        ),
        AgentTemplate(
            id="tmpl_sales_operator",
            label="Sales Operator",
            role="sales-operator",
            department="sales",
            default_floor_id=6,
            model_provider="gemini",
            model_name="gemini-3-flash-preview",
            capabilities=[
                AgentCapability(key="meeting-ops", description="Coordinate outreach and meetings.", integration="google_calendar"),
            ],
            default_tools=["crm_sync", "calendar_scheduler"],
            default_assets=AgentAssetDefaults(
                model_bundle_id="core.agent.sales.v1",
                voice_bundle_id="core.voice.sales.v1",
                workspace_bundle_id="core.workspace.sales.v1",
            ),
        ),
        AgentTemplate(
            id="tmpl_marketing_producer",
            label="Marketing Producer",
            role="campaign-producer",
            department="marketing",
            default_floor_id=5,
            model_provider="gemini",
            model_name="gemini-3-flash-preview",
            capabilities=[
                AgentCapability(key="campaign-assets", description="Create campaign drafts and assets."),
            ],
            default_tools=["asset_writer", "content_planner"],
            default_assets=AgentAssetDefaults(
                model_bundle_id="core.agent.marketing.v1",
                voice_bundle_id="core.voice.marketing.v1",
                workspace_bundle_id="core.workspace.marketing.v1",
            ),
        ),
        AgentTemplate(
            id="tmpl_accounting_controller",
            label="Accounting Controller",
            role="controller",
            department="accounting",
            default_floor_id=3,
            model_provider="gemini",
            model_name="gemini-3-flash-preview",
            capabilities=[
                AgentCapability(key="finance-ops", description="Track books, invoices, and reconciliation."),
            ],
            default_tools=["ledger_writer", "invoice_helper"],
            default_assets=AgentAssetDefaults(
                model_bundle_id="core.agent.accounting.v1",
                voice_bundle_id="core.voice.accounting.v1",
                workspace_bundle_id="core.workspace.accounting.v1",
            ),
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
            asset_overrides=AgentAssetOverrides(),
            created_at=timestamp,
            updated_at=timestamp,
            metadata={"seeded": True, **template.metadata},
        )
        agents_by_floor[str(floor_id)][instance.id] = instance.model_dump()

    return agents_by_floor


def load_company_snapshot(user_id: str) -> CompanySnapshot:
    value = rtdb.reference(_company_path(user_id)).get() or {}
    
    def _get_floor_data(f_val: object, f_id: int) -> dict:
        if isinstance(f_val, list):
            return f_val[f_id] if f_id < len(f_val) and f_val[f_id] else {}
        elif isinstance(f_val, dict):
            return f_val.get(str(f_id)) or {}
        return {}

    def _to_list(obj: object) -> list:
        if isinstance(obj, dict):
            return list(obj.values())
        if isinstance(obj, list):
            return [x for x in obj if x is not None]
        return []

    floors_value = value.get("floors") or {}
    floor_agents: dict[int, list[AgentInstance]] = {}

    for floor in DEFAULT_FLOORS:
        floor_agents[floor.id] = _parse_floor_agents(_get_floor_data(floors_value, floor.id).get("agents", {}))

    templates_raw = value.get("agentTemplates")
    if templates_raw:
        templates = [AgentTemplate.model_validate(item) for item in _to_list(templates_raw)]
    else:
        templates = _default_agent_templates()

    if not templates_raw:
        bootstrap_company(user_id, templates)
        value = rtdb.reference(_company_path(user_id)).get() or {}
        floors_value = value.get("floors") or {}
        floor_agents = {}
        for floor in DEFAULT_FLOORS:
            floor_agents[floor.id] = _parse_floor_agents(_get_floor_data(floors_value, floor.id).get("agents", {}))
        templates_raw2 = value.get("agentTemplates")
        if templates_raw2:
            templates = [AgentTemplate.model_validate(item) for item in _to_list(templates_raw2)]

    assets_val = value.get("assets", {})
    assets_by_id = assets_val.get("byId") if isinstance(assets_val, dict) else None

    return CompanySnapshot(
        user_id=user_id,
        floors=DEFAULT_FLOORS,
        agent_templates=templates,
        floor_agents=floor_agents,
        active_runs=[RuntimeRun.model_validate(item) for item in _to_list(value.get("runs"))],
        assets=[UserAsset.model_validate(item) for item in _to_list(assets_by_id)],
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
    asset_overrides: AgentAssetOverrides | None = None,
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
        asset_overrides=asset_overrides or AgentAssetOverrides(),
        created_at=timestamp,
        updated_at=timestamp,
        metadata=template.metadata,
    )
    rtdb.reference(
        f"{_company_path(user_id)}/floors/{instance.current_floor_id}/agents/{instance.id}"
    ).set(instance.model_dump())
    return instance


def save_user_asset(user_id: str, asset: UserAsset) -> None:
    base = _company_path(user_id)
    rtdb.reference(f"{base}/assets/byId/{asset.id}").set(asset.model_dump())


def update_agent_instance_assets(
    user_id: str,
    agent_id: str,
    asset_overrides: AgentAssetOverrides,
) -> AgentInstance | None:
    company = load_company_snapshot(user_id)
    for floor_id, agents in company.floor_agents.items():
        for agent in agents:
            if agent.id != agent_id:
                continue
            updated_agent = agent.model_copy(
                update={
                    "asset_overrides": asset_overrides,
                    "updated_at": now_ms(),
                }
            )
            rtdb.reference(f"{_company_path(user_id)}/floors/{floor_id}/agents/{agent_id}").set(
                updated_agent.model_dump()
            )
            return updated_agent
    return None


def get_agent_instance(user_id: str, agent_id: str) -> AgentInstance | None:
    company = load_company_snapshot(user_id)
    for agents in company.floor_agents.values():
        for agent in agents:
            if agent.id == agent_id:
                return agent
    return None


def load_agent_conversation(user_id: str, agent_id: str, limit: int = 20) -> list[dict[str, Any]]:
    raw = rtdb.reference(f"{_company_path(user_id)}/agentConversations/{agent_id}/messages").get() or {}
    items: list[dict[str, Any]] = []

    if isinstance(raw, dict):
        for value in raw.values():
            if isinstance(value, dict):
                items.append(value)
    elif isinstance(raw, list):
        for value in raw:
            if isinstance(value, dict):
                items.append(value)

    items.sort(key=lambda item: int(item.get("created_at") or item.get("createdAt") or 0))
    if limit > 0:
        items = items[-limit:]
    return items


def append_agent_conversation_messages(
    user_id: str, agent_id: str, messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not messages:
        return []

    base = f"{_company_path(user_id)}/agentConversations/{agent_id}"
    message_ref = rtdb.reference(f"{base}/messages")
    now = now_ms()
    saved: list[dict[str, Any]] = []

    for message in messages:
        created_at = int(message.get("created_at") or now)
        payload = {
            "id": str(message.get("id") or create_id("msg")),
            "role": str(message.get("role") or "assistant"),
            "text": str(message.get("text") or ""),
            "created_at": created_at,
        }
        message_ref.child(payload["id"]).set(payload)
        saved.append(payload)

    rtdb.reference(base).update(
        {
            "agentId": agent_id,
            "updatedAt": now,
            "lastMessageAt": max(message["created_at"] for message in saved),
        }
    )
    return saved


def clear_agent_conversation(user_id: str, agent_id: str) -> None:
    rtdb.reference(f"{_company_path(user_id)}/agentConversations/{agent_id}").delete()
