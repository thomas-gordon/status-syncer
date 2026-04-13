#!/bin/bash
# Status Watcher — start/stop tunnel + docker

DOMAIN="gui/$(id -u)"

case "$1" in
  start)
    launchctl bootstrap $DOMAIN ~/Library/LaunchAgents/com.statuswatcher.tunnel.plist 2>/dev/null
    launchctl bootstrap $DOMAIN ~/Library/LaunchAgents/com.statuswatcher.docker.plist 2>/dev/null
    launchctl enable $DOMAIN/com.statuswatcher.tunnel
    launchctl enable $DOMAIN/com.statuswatcher.docker
    launchctl kickstart -k $DOMAIN/com.statuswatcher.tunnel
    launchctl kickstart -k $DOMAIN/com.statuswatcher.docker
    echo "Status Watcher started"
    ;;
  stop)
    launchctl bootout $DOMAIN/com.statuswatcher.tunnel 2>/dev/null
    launchctl bootout $DOMAIN/com.statuswatcher.docker 2>/dev/null
    docker compose -f /Users/tomgordon/sites/status-watcher/docker-compose.yml down
    echo "Status Watcher stopped"
    ;;
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
  status)
    echo "Tunnel:"
    launchctl print $DOMAIN/com.statuswatcher.tunnel 2>&1 | grep -E "state|pid" || echo "  not running"
    echo "Docker:"
    launchctl print $DOMAIN/com.statuswatcher.docker 2>&1 | grep -E "state|pid" || echo "  not running"
    ;;
  logs)
    echo "=== Tunnel ===" && tail -20 /tmp/statuswatcher-tunnel.log
    echo ""
    echo "=== Docker ===" && tail -20 /tmp/statuswatcher-docker.log
    ;;
  *)
    echo "Usage: status-watcher.sh {start|stop|restart|status|logs}"
    ;;
esac
