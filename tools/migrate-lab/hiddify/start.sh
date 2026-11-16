#!/bin/bash
# Runs only Hiddify's panel app (no proxies, no host network) against the lab MariaDB and Redis.
set -e
. /opt/hiddify-manager/.venv313/bin/activate
mkdir -p /opt/hiddify-manager/data/hiddify-panel /opt/hiddify-manager/data/log
cat > /opt/hiddify-manager/data/hiddify-panel/app.cfg <<CFG
STDOUT_LOG_LEVEL=INFO
HIDDIFY_CONFIG_PATH=/opt/hiddify-manager/
SECRET_KEY=labSecretKeyForHiddifyOnly123
DEBUG=False
SQLALCHEMY_DATABASE_URI ='mysql+mysqldb://hiddifypanel:hdpass123@hd-db/hiddifypanel?charset=utf8mb4'
REDIS_URI_MAIN = 'redis://hd-redis:6379/0'
CFG
export HIDDIFY_CFG_PATH=/opt/hiddify-manager/data/hiddify-panel/app.cfg
cd /opt/hiddify-manager/services/panel
python3 -m hiddifypanel init-db || true
exec python3 -m granian --interface asgi hiddifypanel.apps.asgi_app:app --host 0.0.0.0 --port 9000
