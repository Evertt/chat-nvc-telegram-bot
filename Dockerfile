FROM denoland/deno

ARG PORT
EXPOSE ${PORT}

WORKDIR /app

ADD . /app

RUN deno cache main.ts

CMD ["run", "-A", "main.ts"]