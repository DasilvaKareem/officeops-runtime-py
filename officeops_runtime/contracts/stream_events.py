from typing import Literal

from pydantic import BaseModel

from officeops_runtime.contracts.artifacts import RuntimeArtifact


class WorkflowStartedEvent(BaseModel):
    type: Literal["workflow_started"] = "workflow_started"
    run_id: str
    total_steps: int | None = None
    message: str | None = None


class AgentStartedEvent(BaseModel):
    type: Literal["agent_started"] = "agent_started"
    run_id: str
    agent: str | None = None
    step_id: str | None = None
    message: str | None = None


class AgentStreamEvent(BaseModel):
    type: Literal["agent_stream"] = "agent_stream"
    run_id: str
    agent: str | None = None
    token: str | None = None
    message: str | None = None


class AgentCompletedEvent(BaseModel):
    type: Literal["agent_completed"] = "agent_completed"
    run_id: str
    agent: str | None = None
    message: str | None = None
    amount: float | None = None


class AgentFailedEvent(BaseModel):
    type: Literal["agent_failed"] = "agent_failed"
    run_id: str
    agent: str | None = None
    error: str | None = None
    message: str | None = None


class PaymentEvent(BaseModel):
    type: Literal["payment"] = "payment"
    run_id: str
    from_agent: str | None = None
    to_agent: str | None = None
    amount: float | None = None
    tx_hash: str | None = None
    status: str | None = None


class MessageEvent(BaseModel):
    type: Literal["message"] = "message"
    run_id: str
    message: str


class WorkflowCompletedEvent(BaseModel):
    type: Literal["workflow_completed"] = "workflow_completed"
    run_id: str
    message: str | None = None
    artifacts: list[RuntimeArtifact] | None = None


class WorkflowFailedEvent(BaseModel):
    type: Literal["workflow_failed"] = "workflow_failed"
    run_id: str
    message: str


StreamEvent = (
    WorkflowStartedEvent
    | AgentStartedEvent
    | AgentStreamEvent
    | AgentCompletedEvent
    | AgentFailedEvent
    | PaymentEvent
    | MessageEvent
    | WorkflowCompletedEvent
    | WorkflowFailedEvent
)
