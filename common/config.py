import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    cassandra_hosts: list[str] = field(
        default_factory=lambda: os.getenv("CASSANDRA_HOSTS", "localhost").split(","))
    cassandra_port: int = int(os.getenv("CASSANDRA_PORT", "9042"))
    keyspace: str = os.getenv("CASSANDRA_KEYSPACE", "fraud_detection")
    kafka_bootstrap: str = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    mlflow_uri: str = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
    artifacts_dir: str = os.getenv("MODEL_ARTIFACTS_DIR", "models/artifacts")
    jwt_secret: str = os.getenv("JWT_SECRET", "change-me")
    jwt_algo: str = "HS256"
    jwt_ttl_minutes: int = int(os.getenv("JWT_TTL_MINUTES", "480"))
    api_url: str = os.getenv("API_URL", "http://localhost:8000")


settings = Settings()

# Demo users — replace with a real IdP / vault in production
API_USERS = {
    "admin":   {"password": os.getenv("ADMIN_PASSWORD", "admin123"),   "role": "admin"},
    "analyst": {"password": os.getenv("ANALYST_PASSWORD", "analyst123"), "role": "analyst"},
}