FROM node:18

WORKDIR /app/site

COPY ./app/package.json ./app/package-lock.json ./

RUN --mount=type=cache,target=/npm-cache \
    npm set cache /npm-cache && \
    npm ci

COPY ./site ./
COPY ./shared ../shared/

RUN npm run build

CMD ["npm", "run", "preview", "--port", "4321"]