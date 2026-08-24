#!/bin/sh
# Fake helper for client tests: emits one click event; getStats commands get
# a canned result reply echoing their seq; captureFrame commands get an
# unsupported ERROR reply (regression coverage for command-failure routing);
# everything else is consumed.
echo '{"type":"event","id":7,"eventType":"click","x":10,"y":20}'
while IFS= read -r line; do
  case "$line" in
    *'"type":"getStats"'*)
      seq=$(printf '%s' "$line" | sed -n 's/.*"seq":\([0-9]*\).*/\1/p')
      printf '{"type":"result","seq":%s,"value":{"frames":3,"p95Ms":0.2}}\n' "$seq"
      ;;
    *'"type":"captureFrame"'*)
      seq=$(printf '%s' "$line" | sed -n 's/.*"seq":\([0-9]*\).*/\1/p')
      printf '{"type":"error","seq":%s,"code":"unsupported","message":"no window in transport mode"}\n' "$seq"
      ;;
  esac
done
exit 0
