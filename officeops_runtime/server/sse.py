from collections.abc import AsyncIterator, Iterable

from officeops_runtime.contracts.stream_events import (
    MessageEvent,
    StreamEvent,
    WorkflowCompletedEvent,
    WorkflowFailedEvent,
    WorkflowStartedEvent,
)
from officeops_runtime.contracts.runtime import RuntimeGraphState


def _serialize(event: StreamEvent) -> str:
    return f"data: {event.model_dump_json()}\n\n"


async def build_stream(events: Iterable[StreamEvent]) -> AsyncIterator[str]:
    for event in events:
        yield _serialize(event)


async def build_success_stream(state: RuntimeGraphState) -> AsyncIterator[str]:
    yield _serialize(
        WorkflowStartedEvent(
            run_id=state.run_id,
            total_steps=8,
            message="Python runtime graph started.",
        )
    )
    for log in state.logs:
        yield _serialize(
            MessageEvent(
                run_id=state.run_id,
                message=f"[{log.stage or log.level}] {log.message}",
            )
        )
    yield _serialize(
        WorkflowCompletedEvent(
            run_id=state.run_id,
            message="Python runtime graph completed.",
            artifacts=state.artifacts,
        )
    )


async def build_failure_stream(run_id: str, message: str) -> AsyncIterator[str]:
    yield _serialize(WorkflowFailedEvent(run_id=run_id, message=message))
