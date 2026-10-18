#!/bin/zsh
exec /usr/bin/arch -arm64 /usr/bin/python3 "${0:A:h}/claude-network.py" browser "$@"
