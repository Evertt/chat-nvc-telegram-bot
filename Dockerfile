FROM denoland/deno

EXPOSE 8080

WORKDIR /app

ADD . /app

RUN deno cache main.ts

CMD ["run", "-A", "main.ts"]