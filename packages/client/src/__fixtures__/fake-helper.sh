#!/bin/sh
# Fake helper for client tests: emits one click event line, then mirrors the
# stdio transport contract (consumes stdin until EOF, exits 0).
echo '{"type":"event","id":7,"eventType":"click","x":10,"y":20}'
cat > /dev/null
exit 0
