FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
# Model files are downloaded on first start into the mounted cache volume.
ENV HF_HOME=/models ASR_HOST=0.0.0.0 ASR_PORT=8765
RUN useradd --create-home asr && mkdir -p /models && chown asr /models
USER asr
EXPOSE 8765
CMD ["python", "server.py"]
