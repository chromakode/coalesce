FROM denoland/deno:1.37.0

WORKDIR /app/project-server

COPY ./project-server/deno.jsonc ./
COPY ./project-server/deps.ts ./

RUN deno cache deps.ts

COPY ./project-server ./
COPY ./shared ../shared/

RUN deno cache ./api/main.ts

CMD ["run", "--allow-net", "--allow-env", "--allow-read=/app/project-server/,/usr/bin/deno", "api/main.ts"]