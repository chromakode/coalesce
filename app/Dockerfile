FROM node:18

WORKDIR /app/frontend

COPY ./app/package.json ./app/package-lock.json ./

RUN --mount=type=cache,target=/npm-cache \
    npm set cache /npm-cache && \
    npm ci

COPY ./app ./
COPY ./shared ../shared/

ARG VITE_PROJECT_SERVER

RUN npm run build

RUN --mount=type=cache,target=/npm-cache \
    npm install serve

CMD ["npx", "serve", "-s", "dist"]