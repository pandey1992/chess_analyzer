from enum import Enum
from pydantic_settings import BaseSettings
from pydantic import Field


class Environment(str, Enum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"


class Settings(BaseSettings):
    # Core
    environment: Environment = Environment.DEVELOPMENT
    groq_api_key: str
    secret_key: str
    algorithm: str = "HS256"

    # Database
    database_url: str = "sqlite+aiosqlite:///./chess_analyzer.db"

    # Auth
    access_token_expire_minutes: int = 1440  # 24h dev, override to 60 in production
    google_client_id: str = ""

    # External APIs
    chess_com_api_base: str = "https://api.chess.com/pub"
    lichess_api_base: str = "https://lichess.org/api"

    # Stockfish engine path
    stockfish_path: str = "stockfish.exe"

    # CORS
    cors_origins: str = "http://localhost:8000,http://localhost:3000"

    # Logging
    log_level: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.environment == Environment.PRODUCTION

    @property
    def async_database_url(self) -> str:
        """Convert standard postgres:// URL to async-compatible format.
        Render provides postgres:// or postgresql://, but SQLAlchemy async
        needs postgresql+asyncpg://."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
