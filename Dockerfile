FROM ecvanbrussel/deno-with-unzip-and-ffmpeg

ARG PORT
EXPOSE ${PORT}

WORKDIR /app
ADD . /app

RUN deno cache src/bot.ts
CMD ["run", "-A", "--unstable", "src/bot.ts"]