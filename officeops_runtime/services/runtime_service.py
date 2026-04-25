from officeops_runtime.graph.state import create_initial_state
from officeops_runtime.graph.workflow import build_workflow
from officeops_runtime.utils.ids import create_id


def run_runtime_graph(user_id: str, floor_id: int, prompt: str):
    graph = build_workflow()
    initial_state = create_initial_state(
        run_id=create_id("run"),
        user_id=user_id,
        floor_id=floor_id,
        prompt=prompt,
    )
    return graph.invoke(initial_state)
