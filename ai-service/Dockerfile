FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY ai-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai-service /app
COPY knowledge_base /knowledge_base:ro

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]