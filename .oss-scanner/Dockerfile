# Build environment for Anthropic's OSS Scanner (https://red.anthropic.com/oss-scanner/).
# The scanner builds this with the repository as the build context and runs the audit offline,
# so everything the audit needs must be fetched here.
# buildpack-deps already has curl, git and ca-certificates, which is all the build needs.
FROM buildpack-deps:trixie-scm@sha256:d524aa66d91264606eddea5b94af462fc3b969b84a1d4083e537a9ab84b579c5

# mise's release installer checks the binary against the checksums built into it.
# It lets the audit run the action against a real mise (`mise install`, `mise env`).
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN curl -fsSL https://github.com/jdx/mise/releases/latest/download/install.sh \
      | MISE_INSTALL_PATH=/usr/local/bin/mise sh
ENV MISE_DATA_DIR=/opt/mise \
    MISE_CACHE_DIR=/opt/mise/cache \
    MISE_YES=1 \
    PATH="/opt/mise/shims:$PATH"

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# node and aube at the versions and checksums in mise.lock, as CI installs them.
RUN mise trust /src/mise.toml && mise install --locked node aube && node --version && aube --version
# Fetch every dependency now, because the audit has no network.
RUN aube install --frozen-lockfile
# Rebuild the bundle the action runs (dist/index.js) from src/.
RUN aubr package
RUN aubr typecheck
# Unit tests import src/*.ts directly; a failure is reported but does not stop the build.
RUN aube test || echo "WARNING: unit tests reported failures"
RUN mise --version
