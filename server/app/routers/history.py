from fastapi import APIRouter

router = APIRouter(prefix="/history", tags=["history"])


@router.get("/")
async def read_history():
    return []
