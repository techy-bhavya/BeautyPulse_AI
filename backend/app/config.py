from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BeautyPulse AI"
    environment: str = "development"
    database_url: str = "sqlite:///./beautypulse.db"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    enable_demo_seed: bool = True
    enable_review_embeddings: bool = True
    cors_origins: str = "*"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def normalized_database_url(self) -> str:
        value = self.database_url.strip()
        if value.startswith("postgres://"):
            value = value.replace("postgres://", "postgresql+psycopg://", 1)
        elif value.startswith("postgresql://") and "+psycopg" not in value:
            value = value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @property
    def is_postgres(self) -> bool:
        return self.normalized_database_url.startswith("postgresql+")

    @property
    def has_openai(self) -> bool:
        return bool(self.openai_api_key)


settings = Settings()
