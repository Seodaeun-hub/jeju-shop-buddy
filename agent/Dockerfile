FROM python:3.11-slim-bookworm
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --system --user-group --no-create-home shopbuddy
COPY strategy_agent ./strategy_agent
USER shopbuddy
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "strategy_agent.api:app", "--host", "0.0.0.0", "--port", "8001"]
