from officeops_runtime.graph.state import create_initial_state
from officeops_runtime.graph.workflow import build_workflow
from officeops_runtime.contracts.runtime import RuntimeGraphState
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
