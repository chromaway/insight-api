#!/bin/bash
export NODE_ENV=production

export BITCOIND_DATADIR=/path/to/bitcoin/datadir/
export BITCOIND_USER=bitcoinrpc
export BITCOIND_PASS=bitcoinrpc_password

export INSIGHT_NETWORK=testnet
export INSIGHT_PORT=3001
export INSIGHT_DB=/path/to/insight/db
export INSIGHT_IGNORE_CACHE=true

node insight.js
