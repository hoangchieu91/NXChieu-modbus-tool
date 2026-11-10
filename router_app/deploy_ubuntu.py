#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy NXChieu Modbus Studio Pro v3.3.7 to Ubuntu ThinkPad T490s (100.126.145.106)
and verify Desktop shortcut (NXChieu-Modbus-Studio.desktop) & toggle_app.sh.
"""

import os
import sys
import time
import paramiko

UBUNTU_HOST = sys.argv[1] if len(sys.argv) > 1 else "100.126.145.106"
UBUNTU_USER = "nxchieu"
UBUNTU_PASS = "DungCliff@1997"
REMOTE_PROJECT_DIR = "/home/nxchieu/projects/NXChieu-modbus-tool"
REMOTE_ROUTER_APP = f"{REMOTE_PROJECT_DIR}/router_app"

LOCAL_BASE = os.path.dirname(os.path.abspath(__file__))

FILES_TO_SYNC = [
    ("ch348_driver.py", f"{REMOTE_ROUTER_APP}/ch348_driver.py"),
    ("sd_profile_manager.py", f"{REMOTE_ROUTER_APP}/sd_profile_manager.py"),
    ("nxmodbus_server.py", f"{REMOTE_ROUTER_APP}/nxmodbus_server.py"),
    ("web/index.html", f"{REMOTE_ROUTER_APP}/web/index.html"),
    ("web/css/studio.css", f"{REMOTE_ROUTER_APP}/web/css/studio.css"),
    ("web/js/app_core.js", f"{REMOTE_ROUTER_APP}/web/js/app_core.js"),
    ("web/js/scanner_gateway_datalog.js", f"{REMOTE_ROUTER_APP}/web/js/scanner_gateway_datalog.js"),
    ("web/js/profile_studio_and_builder.js", f"{REMOTE_ROUTER_APP}/web/js/profile_studio_and_builder.js"),
    ("user_consolidated_skip_profile.json", f"{REMOTE_ROUTER_APP}/modbus_data/profiles/Board_V1_STM32G030_Mo_Rong_Full.json"),
]

TOGGLE_APP_SH = """#!/usr/bin/env bash
APP_DIR="/home/nxchieu/projects/NXChieu-modbus-tool"
SERVER_SCRIPT="$APP_DIR/router_app/nxmodbus_server.py"
LEGACY_BIN="$APP_DIR/nxmodbus-studio-linux"
ICON="$APP_DIR/build/appicon.png"
URL="http://localhost:8098"

is_running() {
    pgrep -f "$SERVER_SCRIPT" > /dev/null 2>&1 || pgrep -f "$LEGACY_BIN" > /dev/null 2>&1
}

start_app() {
    if pgrep -f "$LEGACY_BIN" > /dev/null 2>&1; then
        pkill -f "$LEGACY_BIN" 2>/dev/null
        sleep 0.4
    fi
    if pgrep -f "$SERVER_SCRIPT" > /dev/null 2>&1; then
        notify-send -i "$ICON" "NXChieu Modbus Studio Pro v3.3.7" "Ứng dụng đang chạy sẵn tại $URL" 2>/dev/null
        xdg-open "$URL" > /dev/null 2>&1 &
        exit 0
    fi
    cd "$APP_DIR/router_app" || exit 1
    nohup /usr/bin/python3 "$SERVER_SCRIPT" > "$APP_DIR/app.log" 2>&1 &
    sleep 1.0
    if pgrep -f "$SERVER_SCRIPT" > /dev/null 2>&1; then
        notify-send -i "$ICON" "NXChieu Modbus Studio Pro v3.3.7" "Đã khởi động thành công! Đang mở giao diện $URL" 2>/dev/null
        xdg-open "$URL" > /dev/null 2>&1 &
    else
        notify-send -u critical -i "$ICON" "NXChieu Modbus Studio Pro" "Lỗi khởi động! Xem $APP_DIR/app.log" 2>/dev/null
    fi
}

stop_app() {
    if is_running; then
        pkill -f "$SERVER_SCRIPT" 2>/dev/null
        pkill -f "$LEGACY_BIN" 2>/dev/null
        sleep 0.5
        notify-send -i "$ICON" "NXChieu Modbus Studio Pro" "Đã dừng dịch vụ Modbus Studio an toàn." 2>/dev/null
    else
        notify-send -i "$ICON" "NXChieu Modbus Studio Pro" "Ứng dụng hiện đang tắt." 2>/dev/null
    fi
}

case "$1" in
    start)
        start_app
        ;;
    stop)
        stop_app
        ;;
    restart)
        stop_app
        start_app
        ;;
    toggle|"")
        if is_running; then
            stop_app
        else
            start_app
        fi
        ;;
    status)
        if is_running; then
            echo "RUNNING"
        else
            echo "STOPPED"
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|toggle|status}"
        exit 1
        ;;
esac
"""

DESKTOP_ENTRY = """[Desktop Entry]
Version=1.0
Type=Application
Name=NXChieu Modbus Studio Pro
Comment=Bật / Tắt 1-Click & Quản lý NXChieu Modbus Studio Pro v3.3.7 (localhost:8098 & Router 10.212.156.12)
Exec=/home/nxchieu/projects/NXChieu-modbus-tool/toggle_app.sh start
Icon=/home/nxchieu/projects/NXChieu-modbus-tool/build/appicon.png
Terminal=false
Categories=Development;Engineering;Utility;
StartupNotify=true
Actions=Start;Stop;Restart;OpenLocalWeb;OpenRouterWG;

[Desktop Action Start]
Name=▶ Khởi động & Mở Modbus Studio (Local :8098)
Exec=/home/nxchieu/projects/NXChieu-modbus-tool/toggle_app.sh start

[Desktop Action Stop]
Name=⏹ Dừng dịch vụ Modbus Studio
Exec=/home/nxchieu/projects/NXChieu-modbus-tool/toggle_app.sh stop

[Desktop Action Restart]
Name=🔄 Khởi động lại dịch vụ Modbus Studio
Exec=/home/nxchieu/projects/NXChieu-modbus-tool/toggle_app.sh restart

[Desktop Action OpenLocalWeb]
Name=🌐 Mở Web Studio Trên Máy Ubuntu (localhost:8098)
Exec=xdg-open http://localhost:8098

[Desktop Action OpenRouterWG]
Name=📡 Mở Web Studio Router Hiện Trường (10.212.156.12:8098)
Exec=xdg-open http://10.212.156.12:8098
"""


def main():
    print(f"[*] Connecting to Ubuntu ({UBUNTU_USER}@{UBUNTU_HOST})...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(UBUNTU_HOST, username=UBUNTU_USER, password=UBUNTU_PASS, timeout=10)

    ssh.exec_command(
        f"mkdir -p {REMOTE_ROUTER_APP}/web/css {REMOTE_ROUTER_APP}/web/js "
        f"{REMOTE_ROUTER_APP}/modbus_data/profiles"
    )[1].read()

    sftp = ssh.open_sftp()
    for rel_src, remote_dst in FILES_TO_SYNC:
        local_path = os.path.join(LOCAL_BASE, rel_src)
        if not os.path.exists(local_path):
            print(f"[!] Missing local file: {local_path}")
            continue
        sftp.put(local_path, remote_dst)
        print(f"Uploaded {rel_src} -> {UBUNTU_HOST}:{remote_dst}")

    # Write toggle_app.sh
    with sftp.open(f"{REMOTE_PROJECT_DIR}/toggle_app.sh", "w") as f:
        f.write(TOGGLE_APP_SH)
    # Write Desktop shortcut & ~/.local/share/applications shortcut
    for dpath in [
        "/home/nxchieu/Desktop/NXChieu-Modbus-Studio.desktop",
        "/home/nxchieu/.local/share/applications/NXChieu-Modbus-Studio.desktop",
    ]:
        with sftp.open(dpath, "w") as f:
            f.write(DESKTOP_ENTRY)
    sftp.close()

    # Set executable permissions, mark trusted on GNOME Desktop, and start the server in background
    cmd = (
        f"chmod +x {REMOTE_PROJECT_DIR}/toggle_app.sh {REMOTE_ROUTER_APP}/nxmodbus_server.py "
        f"/home/nxchieu/Desktop/NXChieu-Modbus-Studio.desktop "
        f"/home/nxchieu/.local/share/applications/NXChieu-Modbus-Studio.desktop; "
        f"gio set /home/nxchieu/Desktop/NXChieu-Modbus-Studio.desktop metadata::trusted true 2>/dev/null; "
        f"pkill -f nxmodbus-studio-linux 2>/dev/null; "
        f"pkill -f nxmodbus_server.py 2>/dev/null; "
        f"sleep 0.5; "
        f"nohup /usr/bin/python3 {REMOTE_ROUTER_APP}/nxmodbus_server.py > {REMOTE_PROJECT_DIR}/app.log 2>&1 < /dev/null & "
        f"sleep 1.5; "
        f"ps aux | grep nxmodbus_server.py | grep -v grep; "
        f"curl -s -o /dev/null -w 'HTTP %{{http_code}} (%{{size_download}} bytes)\\n' http://127.0.0.1:8098/; "
        f"curl -s -o /dev/null -w 'API status: HTTP %{{http_code}} (%{{size_download}} bytes)\\n' http://127.0.0.1:8098/api/status"
    )
    _, out, err = ssh.exec_command(cmd)
    print(out.read().decode("utf-8", errors="ignore"))
    err_txt = err.read().decode("utf-8", errors="ignore")
    if err_txt.strip():
        print("STDERR:", err_txt)
    ssh.close()


if __name__ == "__main__":
    main()
