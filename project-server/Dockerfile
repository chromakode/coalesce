FROM denoland/deno

WORKDIR /app/project-server

COPY ./project-server/deps.ts ./

RUN deno cache deps.ts

COPY ./project-server ./
COPY ./shared ../shared/

RUN deno cache main.ts

CMD ["run", "--allow-net", "--allow-env", "main.ts"]