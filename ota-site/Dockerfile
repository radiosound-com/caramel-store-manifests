FROM nginxinc/nginx-unprivileged@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Caramel Vanilla trial site" \
      org.opencontainers.image.description="Developer and DIYer download site for Caramel Vanilla" \
      org.opencontainers.image.source="https://github.com/radiosound-com/caramel-store-manifests" \
      org.opencontainers.image.revision="$VCS_REF"

COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
