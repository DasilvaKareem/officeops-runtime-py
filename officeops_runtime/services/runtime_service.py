from officeops_runtime.graph.state import create_initial_state
from officeops_runtime.graph.workflow import build_workflow
from officeops_runtime.graph.nodes import (
    assistant_response_node,
    artifact_writer_node,
    dispatch_cross_floor_agents,
    finalize_run,
    initialize_run,
    load_company_context,
    planner_node,
    requirements_node,
    review_node,
    route_request,
    runtime_sync_node,
    developer_node,
)
from officeops_runtime.contracts.runtime import RuntimeGraphState
from officeops_runtime.contracts.stream_events import (
    AgentCompletedEvent,
    AgentFailedEvent,
    AgentStartedEvent,
    MessageEvent,
    PaymentEvent,
    StreamEvent,
    WorkflowCompletedEvent,
    WorkflowFailedEvent,
    WorkflowStartedEvent,
)
from officeops_runtime.utils.ids import create_id


def run_runtime_graph(user_id: str, floor_id: int, prompt: str) -> RuntimeGraphState:
    graph = build_workflow()
    initial_state = create_initial_state(
        run_id=create_id("run"),
        user_id=user_id,
        floor_id=floor_id,
        prompt=prompt,
    )
    final_state = graph.invoke(initial_state)
    if isinstance(final_state, RuntimeGraphState):
        return final_state
    return RuntimeGraphState.model_validate(final_state)


STAGE_COSTS = {
    "route_request": 0.0004,
    "requirements_node": 0.0010,
    "planner_node": 0.0012,
    "dispatch_cross_floor_agents": 0.0003,
    "assistant_response_node": 0.0014,
    "developer_node": 0.0020,
    "review_node": 0.0012,
    "artifact_writer_node": 0.0002,
    "runtime_sync_node": 0.0002,
}


def _agent_for_stage(state: RuntimeGraphState, stage_name: str) -> tuple[str | None, str | None]:
    if stage_name == "developer_node":
        agent = next(
            (candidate for candidate in state.active_agents.values() if candidate.current_floor_id == 4),
            None,
        )
    elif stage_name in {"review_node", "assistant_response_node", "route_request", "requirements_node", "planner_node"}:
        agent = next(
            (candidate for candidate in state.active_agents.values() if candidate.current_floor_id == state.floor_id),
            None,
        )
    else:
        agent = None

    if agent is None and state.company is not None:
        target_floor = 4 if stage_name == "developer_node" else state.floor_id
        agent = next(
            (candidate for candidate in state.company.floor_agents.get(target_floor, []) if candidate.enabled),
            None,
        )

    if agent is None:
        return None, None
    return agent.id, f"{agent.label} ({agent.role})"


def _latest_message(state: RuntimeGraphState, previous_log_count: int, fallback: str) -> str:
    new_logs = state.logs[previous_log_count:]
    if new_logs:
        last = new_logs[-1]
        if isinstance(last, dict):
            return str(last.get("message") or fallback)
        return str(getattr(last, "message", fallback) or fallback)
    return fallback


def _log_stage(log: object) -> str:
    if isinstance(log, dict):
        return str(log.get("stage") or log.get("level") or "info")
    return str(getattr(log, "stage", None) or getattr(log, "level", None) or "info")


def _log_message(log: object) -> str:
    if isinstance(log, dict):
        return str(log.get("message") or "")
    return str(getattr(log, "message", "") or "")


def stream_runtime_graph(user_id: str, floor_id: int, prompt: str):
    state = create_initial_state(
        run_id=create_id("run"),
        user_id=user_id,
        floor_id=floor_id,
        prompt=prompt,
    )

    yield WorkflowStartedEvent(
        run_id=state.run_id,
        total_steps=9,
        message="Python runtime graph started.",
    )

    pipeline = [
        ("initialize_run", initialize_run, None),
        ("load_company_context", load_company_context, None),
        ("route_request", route_request, "Routing request"),
        ("requirements_node", requirements_node, "Extracting requirements"),
        ("planner_node", planner_node, "Planning task steps"),
        ("dispatch_cross_floor_agents", dispatch_cross_floor_agents, "Dispatching specialist"),
        ("assistant_response_node", assistant_response_node, "Drafting assistant response"),
        ("developer_node", developer_node, "Generating implementation artifacts"),
        ("review_node", review_node, "Reviewing output"),
        ("artifact_writer_node", artifact_writer_node, "Saving artifacts"),
        ("runtime_sync_node", runtime_sync_node, "Syncing runtime state"),
        ("finalize_run", finalize_run, None),
    ]

    for stage_name, node, started_message in pipeline:
        previous_log_count = len(state.logs)
        agent_id, agent_label = _agent_for_stage(state, stage_name)
        if started_message:
            yield AgentStartedEvent(
                run_id=state.run_id,
                agent=agent_id,
                message=f"{agent_label or stage_name}: {started_message}",
            )

        try:
            state = node(state)
        except Exception as error:  # noqa: BLE001
            yield AgentFailedEvent(
                run_id=state.run_id,
                agent=agent_id,
                error=str(error),
                message=f"{agent_label or stage_name} failed: {error}",
            )
            yield WorkflowFailedEvent(
                run_id=state.run_id,
                message=f"{agent_label or stage_name} failed: {error}",
            )
            return

        for log in state.logs[previous_log_count:]:
            yield MessageEvent(
                run_id=state.run_id,
                message=f"[{_log_stage(log)}] {_log_message(log)}",
            )

        amount = STAGE_COSTS.get(stage_name)
        if amount is not None:
            completed_agent_id, completed_agent_label = _agent_for_stage(state, stage_name)
            message = _latest_message(state, previous_log_count, f"{stage_name} completed.")
            yield AgentCompletedEvent(
                run_id=state.run_id,
                agent=completed_agent_id,
                message=f"{completed_agent_label or stage_name}: {message}",
                amount=amount,
            )
            yield PaymentEvent(
                run_id=state.run_id,
                from_agent="ceo_wallet_sim",
                to_agent=completed_agent_id,
                amount=amount,
                tx_hash=f"sim-{state.run_id}-{stage_name}",
                status="simulated",
            )

    yield WorkflowCompletedEvent(
        run_id=state.run_id,
        message="Python runtime graph completed.",
        artifacts=state.artifacts,
    )
