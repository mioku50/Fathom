set -a
source .env.live
export FATHOM_LIVE_URL=http://localhost:8787
export NO_PROXY="*"
export no_proxy="*"
export NODE_OPTIONS="--dns-result-order=ipv4first --unhandled-rejections=strict"
set +a
bash -x scripts/live_base_sepolia_e2e.sh
