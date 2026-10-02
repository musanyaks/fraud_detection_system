from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
from api.routes import analytics as analytics_routes   # noqa: E402

structlog.configure(processors=[structlog.processors.add_log_level,
                                structlog.processors.TimeStamper(fmt="iso"),
                                structlog.dev.ConsoleRenderer()])
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Wire services once; model bundle must exist (run training first).
    from models.inference import FraudDetectionService
    try:
        app.state.inference = FraudDetectionService()
        log.info("api_inference_loaded")
    except FileNotFoundError as e:
        app.state.inference = None
        log.error("model_bundle_missing", hint=str(e))
    yield


app = FastAPI(title="Fraud Detection Platform", version="1.0.0",
              lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

from api.routes import auth as auth_routes          # noqa: E402
from api.routes import catalog as catalog_routes    # noqa: E402
from api.routes import alerts as alerts_routes      # noqa: E402

catalog_routes.router.app_state = app.state
app.include_router(analytics_routes.router)
app.include_router(auth_routes.router)
app.include_router(catalog_routes.router)
app.include_router(alerts_routes.router)
app.mount("/metrics", make_asgi_app())   # Prometheus