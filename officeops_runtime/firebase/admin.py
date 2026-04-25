import firebase_admin
from firebase_admin import credentials, db, storage

from officeops_runtime.config import settings


def _private_key() -> str | None:
    if not settings.firebase_private_key:
        return None
    return settings.firebase_private_key.replace("\\n", "\n")


def _build_credential():
    private_key = _private_key()
    if settings.firebase_client_email and private_key:
        return credentials.Certificate(
            {
                "project_id": settings.firebase_project_id,
                "client_email": settings.firebase_client_email,
                "private_key": private_key,
            }
        )
    return credentials.ApplicationDefault()


if not firebase_admin._apps:
    firebase_admin.initialize_app(
        _build_credential(),
        {
            "databaseURL": f"https://{settings.firebase_project_id}-default-rtdb.firebaseio.com",
            "storageBucket": settings.firebase_storage_bucket,
        },
    )


rtdb = db
bucket = storage.bucket()
