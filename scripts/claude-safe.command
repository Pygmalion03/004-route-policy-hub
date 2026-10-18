#!/bin/zsh
project="$PWD"
if [[ "$1" == "--project" ]]; then
  project="$2"
  shift 2
fi
exec /usr/bin/arch -arm64 /usr/bin/python3 "${0:A:h}/claude-network.py" --project "$project" run "$@"
