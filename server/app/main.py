from fastapi import FastAPI

from .routers import history

app = FastAPI()

app.include_router(history.router)
