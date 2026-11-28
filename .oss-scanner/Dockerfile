# Build environment for Anthropic's OSS Scanner (https://red.anthropic.com/oss-scanner/).
# The scanner builds this with the repository as the build context and runs the audit offline,
# so everything the audit needs must be fetched here.
# buildpack-deps already has curl, git and ca-certificates, which is all the build needs.
FROM buildpack-deps:trixie-scm@sha256:d524aa66d91264606eddea5b94af462fc3b969b84a1d4083e537a9ab84b579c5

# mise's release installer checks the binary against the checksums built into it. It goes in
# $MISE_DATA_DIR/bin, where the action looks for it, so the audit can run the action against it
# offline (`node .oss-scanner/run-action.mjs`, see threat_model.md).
ENV MISE_DATA_DIR=/opt/mise \
    MISE_CACHE_DIR=/opt/mise/cache \
    MISE_YES=1 \
    PATH="/opt/mise/bin:/opt/mise/shims:$PATH"
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN curl -fsSL https://github.com/jdx/mise/releases/latest/download/install.sh \
      | MISE_INSTALL_PATH=/opt/mise/bin/mise sh

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
# Smoke-test the offline runner the threat model points to.
RUN node .oss-scanner/run-action.mjs > /dev/null
