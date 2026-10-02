from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.authentication.auth import get_current_user, require_role
from db.repositories import AlertRepository

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


class AlertUpdate(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    notes: str | None = None


@router.get("")
def list_alerts(status: str = Query("OPEN"),
                user: dict = Depends(get_current_user)):
    return AlertRepository().list(status, 300)


@router.patch("/{alert_id}")
def update_alert(alert_id: UUID, body: AlertUpdate,
                 user: dict = Depends(require_role("analyst", "admin"))):
    from common.schemas import ALERT_STATUSES
    if body.status and body.status not in ALERT_STATUSES:
        raise HTTPException(400, f"status must be one of {ALERT_STATUSES}")
    try:
        AlertRepository().transition(alert_id, body.status or "OPEN",
                                     body.assigned_to, body.notes)
    except KeyError:
        raise HTTPException(404, "alert not found")
    return {"alert_id": str(alert_id), "status": body.status or "OPEN",
            "assigned_to": body.assigned_to, "notes": body.notes}