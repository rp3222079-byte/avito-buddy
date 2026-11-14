from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness endpoint; it does not make a potentially slow model request."""
    return {"status": "ok"}

