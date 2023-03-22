FROM ecvanbrussel/deno-with-unzip-and-ffmpeg

ARG PORT
EXPOSE ${PORT}

WORKDIR /app
ADD . /app

RUN deno cache src/main.ts
CMD ["run", "-A", "--unstable", "src/main.ts"]