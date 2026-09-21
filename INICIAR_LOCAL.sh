#!/usr/bin/env sh
set -e
[ -d node_modules ] || npm install
npm start
