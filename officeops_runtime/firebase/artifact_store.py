from officeops_runtime.contracts.artifacts import RuntimeArtifact
from officeops_runtime.firebase.admin import bucket
from officeops_runtime.utils.time import now_ms


def persist_artifacts(user_id: str, run_id: str, artifacts: list[RuntimeArtifact]) -> list[RuntimeArtifact]:
    saved: list[RuntimeArtifact] = []

    for artifact in artifacts:
        object_path = f"users/{user_id}/artifacts/{run_id}/{artifact.file_name}"
        blob = bucket.blob(object_path)
        blob.upload_from_string(artifact.content, content_type=artifact.mime_type)
        blob.make_public()
        saved.append(
            artifact.model_copy(
                update={
                    "storage_path": object_path,
                    "download_url": blob.public_url,
                    "created_at": now_ms(),
                }
            )
        )

    return saved
