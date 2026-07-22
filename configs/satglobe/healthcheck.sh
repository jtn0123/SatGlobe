#!/bin/sh

# docker:S7026 is a build-download rule; this is a runtime HTTP health probe.
exec wget -q -O /dev/null http://127.0.0.1:8080/ # NOSONAR
