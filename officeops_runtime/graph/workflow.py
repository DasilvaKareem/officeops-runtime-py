from langgraph.graph import END, START, StateGraph

from officeops_runtime.contracts.runtime import RuntimeGraphState
from officeops_runtime.graph.nodes import (
    artifact_writer_node,
    developer_node,
    dispatch_cross_floor_agents,
    finalize_run,
    initialize_run,
    load_company_context,
    planner_node,
    requirements_node,
    review_node,
    route_request,
    runtime_sync_node,
)


def build_workflow():
    graph = StateGraph(RuntimeGraphState)
    graph.add_node("initialize_run", initialize_run)
    graph.add_node("load_company_context", load_company_context)
    graph.add_node("route_request", route_request)
    graph.add_node("requirements_node", requirements_node)
    graph.add_node("planner_node", planner_node)
    graph.add_node("dispatch_cross_floor_agents", dispatch_cross_floor_agents)
    graph.add_node("developer_node", developer_node)
    graph.add_node("review_node", review_node)
    graph.add_node("artifact_writer_node", artifact_writer_node)
    graph.add_node("runtime_sync_node", runtime_sync_node)
    graph.add_node("finalize_run", finalize_run)

    graph.add_edge(START, "initialize_run")
    graph.add_edge("initialize_run", "load_company_context")
    graph.add_edge("load_company_context", "route_request")
    graph.add_edge("route_request", "requirements_node")
    graph.add_edge("requirements_node", "planner_node")
    graph.add_edge("planner_node", "dispatch_cross_floor_agents")
    graph.add_edge("dispatch_cross_floor_agents", "developer_node")
    graph.add_edge("developer_node", "review_node")
    graph.add_edge("review_node", "artifact_writer_node")
    graph.add_edge("artifact_writer_node", "runtime_sync_node")
    graph.add_edge("runtime_sync_node", "finalize_run")
    graph.add_edge("finalize_run", END)

    return graph.compile()
