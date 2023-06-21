FROM node:20

WORKDIR /app/frontend

COPY ./app/package.json ./app/package-lock.json ./

RUN npm install

COPY ./app ./
COPY ./shared ../shared/

RUN npm run build

RUN npm install serve

CMD ["npx", "serve", "-s", "dist"]