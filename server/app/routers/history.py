from fastapi import APIRouter

from pydantic import BaseModel

from ..schema import get_connection


router = APIRouter(prefix="/history", tags=["history"])


class HistoryItem(BaseModel):
    user: int | None = None
    domain: int | None = None
    url: str

    duration_seconds: int


@router.post("/add", status_code=201)
async def add_history_item(item: HistoryItem):
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO history (user, domain, url, duration_seconds) VALUES (?, ?, ?, ?)",
            (item.user, item.domain, item.url, item.duration_seconds),
        )

    return {"id": cursor.lastrowid}
