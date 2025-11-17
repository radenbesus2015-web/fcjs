# Base image
FROM python:3.11-bookworm

# Environment
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt /tmp/requirements.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r /tmp/requirements.txt

# Copy application code
COPY . /app

# Expose default port for FastAPI
EXPOSE 5000

# Use Uvicorn directly for production
CMD ["uvicorn", "main_fastapi:app", "--host", "0.0.0.0", "--port", "5000", "--reload"]
