import uvicorn

from officeops_runtime.config import settings


if __name__ == "__main__":
    uvicorn.run("officeops_runtime.server.main:app", host="0.0.0.0", port=settings.port, reload=True)
