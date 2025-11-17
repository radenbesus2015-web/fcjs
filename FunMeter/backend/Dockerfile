FROM python:3.11-bookworm

# Optimize Python environment
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=100

WORKDIR /app/backend

# Install system dependencies with optimizations
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libgl1-mesa-glx \
        libglib2.0-0 \
        libgomp1 \
        libgthread-2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libfontconfig1 \
        libice6 \
        libx11-6 \
        libxau6 \
        libxdmcp6 \
        libxcb1 \
        libxss1 \
        libxtst6 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy requirements first for better Docker layer caching
COPY requirements.txt /tmp/requirements.txt

# Install Python dependencies with optimizations
RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --compile -r /tmp/requirements.txt

# Copy application code
COPY . /app/backend

# Set optimized environment variables
ENV OPENCV_BACKEND=cpu \
    USE_REDIS=0 \
    OPENCV_LOG_LEVEL=SILENT \
    OMP_NUM_THREADS=4 \
    MKL_NUM_THREADS=4

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app/backend
USER app

EXPOSE 5000

# Use optimized startup command
CMD ["python", "serve.py", "--host", "0.0.0.0", "--port", "5000"]
