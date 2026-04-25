FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

WORKDIR /app

COPY pyproject.toml README.md ./
COPY officeops_runtime ./officeops_runtime
COPY run.py ./run.py

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

CMD ["uvicorn", "officeops_runtime.server.main:app", "--host", "0.0.0.0", "--port", "8080"]
