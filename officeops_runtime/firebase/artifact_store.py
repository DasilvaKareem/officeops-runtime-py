import hashlib
from pathlib import Path

from officeops_runtime.contracts.artifacts import RuntimeArtifact
from officeops_runtime.contracts.runtime import UserAsset
from officeops_runtime.firebase.admin import bucket
from officeops_runtime.utils.ids import create_id
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


def persist_user_asset_upload(
    *,
    user_id: str,
    kind: str,
    file_name: str,
    content_type: str,
    payload: bytes,
    metadata: dict[str, object] | None = None,
) -> UserAsset:
    asset_id = create_id("asset")
    extension = Path(file_name).suffix or ""
    object_path = f"users/{user_id}/assets/{kind}s/{asset_id}/original{extension}"
    blob = bucket.blob(object_path)
    blob.upload_from_string(payload, content_type=content_type)
    blob.make_public()

    timestamp = now_ms()
    return UserAsset(
        id=asset_id,
        name=file_name,
        kind=kind,  # type: ignore[arg-type]
        format=extension.lstrip(".") or content_type.split("/")[-1],
        storage_path=object_path,
        download_url=blob.public_url,
        thumbnail_url=None,
        version=1,
        checksum=hashlib.sha256(payload).hexdigest(),
        size=len(payload),
        owner_uid=user_id,
        created_at=timestamp,
        updated_at=timestamp,
        metadata=metadata or {},
    )
