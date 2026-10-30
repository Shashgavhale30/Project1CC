# Separate test container for ContactFlow (does not touch the live backend).
FROM node:20-alpine
WORKDIR /app
COPY server.js ./
ENV PORT=10000
EXPOSE 10000
USER node
CMD ["node", "server.js"]
