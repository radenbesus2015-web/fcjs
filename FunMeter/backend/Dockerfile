FROM python:3.11-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt /tmp/requirements.txt

# Upgrade pip dan install semua package dengan python -m pip
RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install -r /tmp/requirements.txt

# Copy source code
COPY . /app

EXPOSE 5000

# Gunakan uvicorn langsung tanpa reloader di production
CMD ["uvicorn", "main_fastapi:app", "--host", "0.0.0.0", "--port", "5000"]
