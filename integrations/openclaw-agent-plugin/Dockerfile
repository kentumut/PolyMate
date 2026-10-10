ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${NODE_IMAGE}
WORKDIR /opt/openclaw
RUN npm install --no-audit --no-fund openclaw@2026.9.9
COPY integrations/openclaw-agent-plugin ./node_modules/@polymate/openclaw-agent-plugin
RUN node node_modules/openclaw/openclaw.mjs plugins build --root node_modules/@polymate/openclaw-agent-plugin --entry ./index.mjs \
 && node node_modules/openclaw/openclaw.mjs plugins validate --root node_modules/@polymate/openclaw-agent-plugin --entry ./index.mjs
COPY scripts/openclaw-config.mjs scripts/openclaw-container.mjs /opt/polymate/scripts/
COPY integrations/openclaw-agent-plugin/openclaw.plugin.json /opt/polymate/integrations/openclaw-agent-plugin/openclaw.plugin.json
# The deploy checkout is owner-only (umask 077) and COPY keeps those modes; the gateway runs as node.
RUN chmod -R a+rX /opt/openclaw/node_modules/@polymate /opt/polymate
RUN mkdir -p /home/node/.openclaw && chown node:node /home/node/.openclaw
ENV NODE_ENV=production OPENCLAW_STATE_DIR=/home/node/.openclaw
USER node
CMD ["node", "/opt/polymate/scripts/openclaw-container.mjs"]
