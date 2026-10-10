from contextlib import asynccontextmanager

from fastapi import FastAPI

from .routers import history
from .schema import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(history.router)
