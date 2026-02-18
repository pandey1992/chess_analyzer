import os
import logging
import mimetypes
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.config import settings
from backend.database import engine, Base
from backend.api import chess_api, groq_api, auth, pro

# --- Logging ---
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("chess_analyzer")

# Ensure correct MIME types for static assets on Windows environments where
# .js can be mapped to text/plain via system registry settings.
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# --- Rate Limiter ---
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting Chess Analyzer ({settings.environment.value} mode)")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    logger.info("Shutting down Chess Analyzer")


app = FastAPI(
    title="Chess AI Coach API",
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
)

# Attach limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=3600,
)


# --- Security Headers Middleware ---
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    content_type = response.headers.get("content-type", "")
    is_html = content_type.startswith("text/html")
    if request.url.path.startswith("/js/") or request.url.path.startswith("/css/") or is_html:
        # Avoid stale browser cache metadata for static assets and HTML shells.
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self' https://accounts.google.com; "
            "font-src 'self'; "
            "frame-src 'self' https://accounts.google.com"
        )
    return response


# --- Health Check Endpoints ---
@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "environment": settings.environment.value,
        "google_auth_enabled": bool(settings.google_client_id),
    }


@app.get("/health/auth")
async def auth_health_check():
    return {
        "status": "ok",
        "google_auth_enabled": bool(settings.google_client_id),
    }


@app.get("/ready")
async def readiness_check():
    from sqlalchemy import text
    from backend.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready"}
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "error": str(e)},
        )


# --- API Routes ---
app.include_router(chess_api.router, prefix="/api")
app.include_router(groq_api.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(pro.router, prefix="/api/pro")

# --- Static Files ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")


@app.get("/")
async def serve_frontend():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/privacy")
async def serve_privacy_policy():
    return FileResponse(os.path.join(FRONTEND_DIR, "privacy.html"))


@app.get("/terms")
async def serve_terms_of_service():
    return FileResponse(os.path.join(FRONTEND_DIR, "terms.html"))
