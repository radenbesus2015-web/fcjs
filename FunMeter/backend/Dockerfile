FROM python:3.11-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt

RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app

# Gunakan PORT default production = 5000
EXPOSE 5000

CMD ["python", "serve.py", "--host", "0.0.0.0", "--port", "5000"]
