from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HistoryCreate(HistoryBase):
    visited_at: datetime | None = None


class HistoryItem(HistoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    visited_at: datetime
