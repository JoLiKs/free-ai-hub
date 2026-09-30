FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080 DB_PATH=/data/fah.db
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin fah \
 && mkdir /data && chown fah /data
COPY app ./app
USER fah
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --retries=3 CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/api/health',timeout=3)" || exit 1
CMD ["python", "-m", "app"]
