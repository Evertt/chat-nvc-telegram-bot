FROM ecvanbrussel/deno-with-unzip-and-ffmpeg

ARG PORT
EXPOSE ${PORT}

WORKDIR /app
ADD . /app

RUN deno cache main.ts
CMD ["run", "-A", "--unstable", "main.ts"]