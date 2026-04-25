import json

from officeops_runtime.contracts.artifacts import RuntimeArtifact
from officeops_runtime.contracts.runtime import (
    AgentInstance,
    ElevatorTransfer,
    RuntimeGraphState,
    RuntimeRoute,
    RuntimeRun,
)
from officeops_runtime.firebase.artifact_store import persist_artifacts
from officeops_runtime.firebase.company_runtime import (
    load_company_snapshot,
    save_artifacts,
    save_run,
    save_transfer,
)
from officeops_runtime.llm.gemini import GeminiError, generate_json, generate_text
from officeops_runtime.llm.prompts import (
    DEVELOPER_SYSTEM_PROMPT,
    PLANNER_SYSTEM_PROMPT,
    REQUIREMENTS_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    ROUTER_SYSTEM_PROMPT,
)
from officeops_runtime.utils.ids import create_id
from officeops_runtime.utils.time import now_ms


def initialize_run(state: RuntimeGraphState) -> RuntimeGraphState:
    state.logs.append(
        {"level": "info", "message": "Run initialized.", "at": now_ms(), "stage": "initialize"}
    )
    return state


def _pick_agent_for_floor(state: RuntimeGraphState, floor_id: int) -> AgentInstance | None:
    if state.company is None:
        return None

    floor_agents = state.company.floor_agents.get(floor_id, [])
    enabled_agents = [agent for agent in floor_agents if agent.enabled]
    if enabled_agents:
        return enabled_agents[0]

    floor_definition = next((floor for floor in state.company.floors if floor.id == floor_id), None)
    if floor_definition is None:
        return None

    for template in state.company.agent_templates:
        if template.department == floor_definition.department:
            timestamp = now_ms()
            return AgentInstance(
                id=f"virtual_{template.id}",
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
                metadata={"virtual": True, **template.metadata},
            )

    return None


def load_company_context(state: RuntimeGraphState) -> RuntimeGraphState:
    state.company = load_company_snapshot(state.user_id)
    state.logs.append(
        {
            "level": "info",
            "message": f"Loaded {len(state.company.floors)} floors.",
            "at": now_ms(),
            "stage": "load_company",
        }
    )
    return state


def route_request(state: RuntimeGraphState) -> RuntimeGraphState:
    prompt = state.prompt.lower()
    route = RuntimeRoute(mode="full", reason="Default cross-floor execution path.")
    try:
        route_payload = generate_json(
            system_instruction=ROUTER_SYSTEM_PROMPT,
            prompt=(
                "Classify this request into one of: full, plan_only, review_only, quick_fix.\n"
                "Return JSON: {\"mode\": string, \"reason\": string}\n\n"
                f"Request:\n{state.prompt}"
            ),
        )
        route = RuntimeRoute(
            mode=route_payload.get("mode", "full"),
            reason=route_payload.get("reason", "Gemini routed the request."),
        )
    except (GeminiError, json.JSONDecodeError, ValueError):
        if any(keyword in prompt for keyword in ("review", "audit", "check")):
            route = RuntimeRoute(mode="review_only", reason="Prompt is review-heavy.")
        elif any(keyword in prompt for keyword in ("fix", "bug", "small change")):
            route = RuntimeRoute(mode="quick_fix", reason="Prompt looks like a fast implementation change.")
        elif any(keyword in prompt for keyword in ("plan", "strategy", "roadmap", "architecture")):
            route = RuntimeRoute(mode="plan_only", reason="Prompt looks planning-focused.")

    state.route = route
    state.logs.append(
        {
            "level": "info",
            "message": f"Request routed as {route.mode}.",
            "at": now_ms(),
            "stage": "route",
        }
    )
    return state


def requirements_node(state: RuntimeGraphState) -> RuntimeGraphState:
    try:
        state.requirements = generate_text(
            system_instruction=REQUIREMENTS_SYSTEM_PROMPT,
            prompt=f"Analyze this request and produce requirements markdown:\n\n{state.prompt}",
            temperature=0.2,
        )
    except GeminiError:
        state.requirements = f"Requirements extracted from prompt:\n\n{state.prompt}"
    state.artifacts.append(
        RuntimeArtifact(
            id=create_id("artifact"),
            file_name="requirements-analysis.md",
            mime_type="text/markdown",
            content=state.requirements,
            kind="report",
            floor_id=state.floor_id,
            stage="requirements",
        )
    )
    return state


def planner_node(state: RuntimeGraphState) -> RuntimeGraphState:
    try:
        task_plan_payload = generate_json(
            system_instruction=PLANNER_SYSTEM_PROMPT,
            prompt=(
                "Create a task plan for this request.\n\n"
                f"Requirements:\n{state.requirements or state.prompt}"
            ),
        )
        state.task_plan = json.dumps(task_plan_payload, indent=2)
    except (GeminiError, json.JSONDecodeError):
        state.task_plan = (
            '{\n'
            '  "summary": "Initial scaffolded plan",\n'
            '  "tasks": [\n'
            '    {"id": "task_requirements", "title": "Clarify request ownership", "floorId": 7, "ownerRole": "router"},\n'
            '    {"id": "task_build", "title": "Produce working artifacts", "floorId": 4, "ownerRole": "builder"},\n'
            '    {"id": "task_review", "title": "Validate output", "floorId": 7, "ownerRole": "reviewer"}\n'
            "  ]\n"
            "}"
        )
    state.artifacts.append(
        RuntimeArtifact(
            id=create_id("artifact"),
            file_name="task-plan.json",
            mime_type="application/json",
            content=state.task_plan,
            kind="json",
            floor_id=state.floor_id,
            stage="planner",
        )
    )
    return state


def dispatch_cross_floor_agents(state: RuntimeGraphState) -> RuntimeGraphState:
    target_floor = 4
    prompt = state.prompt.lower()
    if any(keyword in prompt for keyword in ("sales", "outreach", "lead", "crm")):
        target_floor = 6
    elif any(keyword in prompt for keyword in ("marketing", "campaign", "brand", "content")):
        target_floor = 5
    elif any(keyword in prompt for keyword in ("accounting", "invoice", "bookkeeping", "finance")):
        target_floor = 3
    elif any(keyword in prompt for keyword in ("hr", "hiring", "recruit", "people")):
        target_floor = 2

    selected_agent = _pick_agent_for_floor(state, target_floor)
    transfer = ElevatorTransfer(
        id=create_id("transfer"),
        agent_id=selected_agent.id if selected_agent else "dynamic_exec_router",
        from_floor_id=state.floor_id,
        to_floor_id=target_floor,
        reason=f"Cross-floor specialist dispatch to floor {target_floor}.",
        status="queued",
        requested_at=now_ms(),
        updated_at=now_ms(),
        run_id=state.run_id,
    )
    state.transfer_requests.append(transfer)
    if selected_agent is not None:
        selected_agent.status = "moving"
        selected_agent.current_task = f"Handling run {state.run_id}"
        selected_agent.updated_at = now_ms()
        state.active_agents[selected_agent.id] = selected_agent
        state.logs.append(
            {
                "level": "info",
                "message": f"Selected {selected_agent.label} on floor {target_floor} for this run.",
                "at": now_ms(),
                "agent_id": selected_agent.id,
                "stage": "dispatch",
            }
        )
    else:
        state.logs.append(
            {
                "level": "warning",
                "message": f"No live agent found on floor {target_floor}; using fallback dispatch metadata.",
                "at": now_ms(),
                "stage": "dispatch",
            }
        )
    return state


def developer_node(state: RuntimeGraphState) -> RuntimeGraphState:
    developer_agent = _pick_agent_for_floor(state, 4)
    if developer_agent is not None:
        developer_agent.status = "working"
        developer_agent.current_task = "Producing implementation artifacts"
        developer_agent.updated_at = now_ms()
        state.active_agents[developer_agent.id] = developer_agent

    try:
        developer_payload = generate_json(
            system_instruction=DEVELOPER_SYSTEM_PROMPT,
            prompt=(
                f"User request:\n{state.prompt}\n\n"
                f"Requirements:\n{state.requirements or ''}\n\n"
                f"Task plan:\n{state.task_plan or ''}"
            ),
        )
        state.code_output = developer_payload.get("summary", "")
        for artifact_payload in developer_payload.get("artifacts", []):
            state.artifacts.append(
                RuntimeArtifact(
                    id=create_id("artifact"),
                    file_name=artifact_payload.get("file_name", "artifact.txt"),
                    mime_type=artifact_payload.get("mime_type", "text/plain"),
                    content=artifact_payload.get("content", ""),
                    kind=artifact_payload.get("kind", "report"),
                    floor_id=state.floor_id,
                    stage="developer",
                )
            )
    except (GeminiError, json.JSONDecodeError, ValueError):
        html = (
            "<!DOCTYPE html>"
            "<html lang='en'>"
            "<head><meta charset='UTF-8' /><meta name='viewport' content='width=device-width, initial-scale=1.0' />"
            "<title>OfficeOps Runtime Output</title></head>"
            f"<body><main><h1>{state.prompt}</h1><p>Generated by Python runtime scaffold.</p></main></body></html>"
        )
        state.code_output = html
        state.artifacts.append(
            RuntimeArtifact(
                id=create_id("artifact"),
                file_name="index.html",
                mime_type="text/html",
                content=html,
                kind="html",
                floor_id=state.floor_id,
                stage="developer",
            )
        )
    state.logs.append(
        {
            "level": "info",
            "message": f"Developer generated {len([artifact for artifact in state.artifacts if artifact.stage == 'developer'])} artifact(s).",
            "at": now_ms(),
            "agent_id": developer_agent.id if developer_agent is not None else None,
            "stage": "developer",
        }
    )
    return state


def review_node(state: RuntimeGraphState) -> RuntimeGraphState:
    reviewer_agent = _pick_agent_for_floor(state, 7)
    if reviewer_agent is not None:
        reviewer_agent.status = "working"
        reviewer_agent.current_task = "Reviewing generated artifacts"
        reviewer_agent.updated_at = now_ms()
        state.active_agents[reviewer_agent.id] = reviewer_agent

    try:
        state.review_output = generate_text(
            system_instruction=REVIEW_SYSTEM_PROMPT,
            prompt=(
                f"Review these artifacts for the request.\n\n"
                f"Prompt:\n{state.prompt}\n\n"
                f"Requirements:\n{state.requirements or ''}\n\n"
                f"Artifacts:\n{json.dumps([artifact.model_dump() for artifact in state.artifacts], indent=2)}"
            ),
            temperature=0.2,
        )
    except GeminiError:
        state.review_output = "Review scaffold: accepted for initial Python runtime bootstrap."
    state.artifacts.append(
        RuntimeArtifact(
            id=create_id("artifact"),
            file_name="review-report.md",
            mime_type="text/markdown",
            content=state.review_output,
            kind="report",
            floor_id=state.floor_id,
            stage="review",
        )
    )
    state.logs.append(
        {
            "level": "info",
            "message": "Review artifact generated.",
            "at": now_ms(),
            "agent_id": reviewer_agent.id if reviewer_agent is not None else None,
            "stage": "review",
        }
    )
    return state


def artifact_writer_node(state: RuntimeGraphState) -> RuntimeGraphState:
    persisted = persist_artifacts(state.user_id, state.run_id, state.artifacts)
    save_artifacts(state.user_id, state.run_id, persisted)
    state.artifacts = persisted
    return state


def runtime_sync_node(state: RuntimeGraphState) -> RuntimeGraphState:
    run = RuntimeRun(
        id=state.run_id,
        user_id=state.user_id,
        floor_id=state.floor_id,
        prompt=state.prompt,
        status=state.status,
        started_at=state.logs[0].at if state.logs else now_ms(),
        updated_at=now_ms(),
        artifact_ids=[artifact.id for artifact in state.artifacts if artifact.id],
        active_agent_ids=list(state.active_agents.keys()),
        last_message=state.logs[-1].message if state.logs else None,
    )
    save_run(state.user_id, run)
    for transfer in state.transfer_requests:
        save_transfer(state.user_id, transfer)
    for agent in state.active_agents.values():
        state.logs.append(
            {
                "level": "info",
                "message": f"Agent {agent.label} is tracked for this run on floor {agent.current_floor_id}.",
                "at": now_ms(),
                "agent_id": agent.id,
                "stage": "runtime_sync",
            }
        )
    return state


def finalize_run(state: RuntimeGraphState) -> RuntimeGraphState:
    state.status = "complete"
    state.logs.append(
        {"level": "info", "message": "Run finalized.", "at": now_ms(), "stage": "finalize"}
    )
    return state
