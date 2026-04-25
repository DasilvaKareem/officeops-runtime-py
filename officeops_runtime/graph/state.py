from officeops_runtime.contracts.runtime import RuntimeGraphState


def create_initial_state(run_id: str, user_id: str, floor_id: int, prompt: str) -> RuntimeGraphState:
    return RuntimeGraphState(
        run_id=run_id,
        user_id=user_id,
        floor_id=floor_id,
        prompt=prompt,
        status="running",
    )
