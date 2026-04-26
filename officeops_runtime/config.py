from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    port: int = Field(default=3002, alias="PORT")
    firebase_project_id: str = Field(alias="FIREBASE_PROJECT_ID")
    firebase_storage_bucket: str = Field(alias="FIREBASE_STORAGE_BUCKET")
    firebase_client_email: str | None = Field(default=None, alias="FIREBASE_CLIENT_EMAIL")
    firebase_private_key: str | None = Field(default=None, alias="FIREBASE_PRIVATE_KEY")
    default_model_provider: str = Field(default="google", alias="DEFAULT_MODEL_PROVIDER")
    default_model_name: str = Field(default="gemini-3-flash-preview", alias="DEFAULT_MODEL_NAME")
    google_cloud_project: str | None = Field(default=None, alias="GOOGLE_CLOUD_PROJECT")
    google_cloud_location: str = Field(default="global", alias="GOOGLE_CLOUD_LOCATION")
    google_genai_use_vertexai: bool = Field(default=True, alias="GOOGLE_GENAI_USE_VERTEXAI")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")


settings = Settings()
