# One file, the standard library, nothing to install: the deploy exercises the
# Dockerfile path rather than buildpack detection, and the image is a few
# seconds to build.
FROM python:3.12-slim
WORKDIR /app
COPY app.py .
ENV PYTHONUNBUFFERED=1
# Cloud Run sets PORT; the service reads it and defaults to 8080.
CMD ["python", "app.py"]
