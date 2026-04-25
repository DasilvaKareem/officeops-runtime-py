from typing import Literal

from pydantic import BaseModel


ArtifactKind = Literal["code", "report", "json", "notes", "html", "media"]


class RuntimeArtifact(BaseModel):
    id: str | None = None
    file_name: str
    mime_type: str
    content: str
    kind: ArtifactKind
    agent_id: str | None = None
    agent_template_id: str | None = None
    floor_id: int | None = None
    stage: str | None = None
    storage_path: str | None = None
    download_url: str | None = None
    created_at: int | None = None
