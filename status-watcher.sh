#!/bin/bash
# Status Watcher — start/stop tunnel + docker

case "$1" in
  start)
    launchctl load ~/Library/LaunchAgents/com.statuswatcher.tunnel.plist
    launchctl load ~/Library/LaunchAgents/com.statuswatcher.docker.plist
    echo "Status Watcher started"
    ;;
  stop)
    launchctl unload ~/Library/LaunchAgents/com.statuswatcher.tunnel.plist
    launchctl unload ~/Library/LaunchAgents/com.statuswatcher.docker.plist
    docker compose -f /Users/tomgordon/sites/status-watcher/docker-compose.yml down
    echo "Status Watcher stopped"
    ;;
  restart)
    $0 stop
    $0 start
    ;;
  status)
    echo "Tunnel:"
    launchctl list | grep statuswatcher.tunnel || echo "  not running"
    echo "Docker:"
    launchctl list | grep statuswatcher.docker || echo "  not running"
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
