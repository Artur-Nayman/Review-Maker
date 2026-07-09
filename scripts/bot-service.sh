#!/usr/bin/env bash
set -euo pipefail

PROJECT="Review-Maker Discord Bot"

case "${1:-}" in
  start)
    echo "Starting $PROJECT..."
    systemctl --user start review-bot.service
    echo "Done. Check status with: $0 status"
    ;;
  stop)
    echo "Stopping $PROJECT..."
    systemctl --user stop review-bot.service
    echo "Done."
    ;;
  restart)
    echo "Restarting $PROJECT..."
    systemctl --user restart review-bot.service
    echo "Done."
    ;;
  status)
    systemctl --user status review-bot.service
    ;;
  logs)
    journalctl --user -u review-bot.service -n 50 -f
    ;;
  enable)
    systemctl --user enable review-bot.service
    echo "Service will start automatically on boot."
    ;;
  disable)
    systemctl --user disable review-bot.service
    echo "Service will no longer start on boot."
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|enable|disable}"
    exit 1
    ;;
esac
