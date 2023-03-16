FROM ecvanbrussel/deno-with-unzip-and-ffmpeg

# RUN apt-get update
# RUN apt-get -y install unzip ffmpeg

ARG PORT
EXPOSE ${PORT}

WORKDIR /app
ADD . /app

RUN deno cache main.ts
CMD ["run", "-A", "--unstable", "main.ts"]