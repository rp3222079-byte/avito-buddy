import hashlib
import hmac
from datetime import datetime, timezone

from fastapi import HTTPException, Request

REQUEST_CONTEXT_MAX_AGE_SECONDS = 60


def trusted_context(
    request: Request,
    token: str | None,
    user_id: str | None,
    role: str | None,
    signed_context: str | None,
) -> tuple[str, str]:
    expected_token = getattr(request.app.state, "internal_token", "")
    if not expected_token:
        raise HTTPException(
            status_code=503, detail="AI-service internal auth is not configured"
        )
    if not token or not hmac.compare_digest(token, expected_token):
        raise HTTPException(status_code=401, detail="Internal service authentication required")
    if not user_id or not role:
        raise HTTPException(status_code=401, detail="Backend identity is required")

    context_secret = getattr(request.app.state, "request_context_secret", "")
    if context_secret:
        if not signed_context:
            raise HTTPException(status_code=401, detail="Signed request context is required")
        try:
            payload, signature = signed_context.rsplit(".", 1)
            context_user_id, context_role, timestamp = payload.split("|", 2)
            requested_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=401, detail="Invalid request context") from error
        expected_signature = hmac.new(
            context_secret.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            raise HTTPException(status_code=401, detail="Invalid request context")
        if requested_at.tzinfo is None:
            raise HTTPException(status_code=401, detail="Invalid request context")
        age = abs((datetime.now(timezone.utc) - requested_at).total_seconds())
        if age > REQUEST_CONTEXT_MAX_AGE_SECONDS:
            raise HTTPException(status_code=401, detail="Request context expired")
        if context_user_id != user_id or context_role != role:
            raise HTTPException(status_code=401, detail="Request context identity mismatch")
    return user_id, role
