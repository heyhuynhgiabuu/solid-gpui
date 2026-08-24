#!/bin/sh
# Fake helper for client tests: emits one click event, then answers any
# getStats command line with a result reply echoing the command's seq;
# consumes everything else.
echo '{"type":"event","id":7,"eventType":"click","x":10,"y":20}'
while IFS= read -r line; do
  case "$line" in
    *'"type":"getStats"'*)
      seq=$(printf '%s' "$line" | sed -n 's/.*"seq":\([0-9]*\).*/\1/p')
      printf '{"type":"result","seq":%s,"value":{"frames":3,"p95Ms":0.2}}\n' "$seq"
      ;;
  esac
done
exit 0
