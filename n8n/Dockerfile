# Образ за one-shot услугата `n8n-setup`: същата версия на n8n + workflow-ите и
# setup скрипта. Нужен е, защото Portainer деплойва само YAML-а — без файловете на
# проекта. Версията трябва да съвпада с образа на `n8n` в docker-compose.yml.
ARG N8N_IMAGE=docker.n8n.io/n8nio/n8n:2.47.3
FROM ${N8N_IMAGE}
COPY workflows/booking-agent.json workflows/chat-purge.json /opt/barber-n8n/workflows/
COPY setup.mjs /opt/barber-n8n/setup.mjs
ENTRYPOINT ["node", "/opt/barber-n8n/setup.mjs"]
