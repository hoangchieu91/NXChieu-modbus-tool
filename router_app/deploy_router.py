#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-Deploy NXChieu Modbus Web Studio Pro (v3.3.5) to GL.iNet GL-XE300 Router.
Primary management endpoint: WireGuard VPN (10.212.156.12)
Fallback management endpoint: Local LAN (192.168.10.1)
"""

import socket
import subprocess
import sys
import urllib.request

PSCP = r"C:\Program Files\PuTTY\pscp.exe"
PLINK = r"C:\Program Files\PuTTY\plink.exe"
HOSTKEY = "SHA256:/PyMgqQCfiv10iKWXs2LI29uaqLBEiZeOWYiw+CbBYQ"
PASS = "Admin@12345"
CANDIDATE_HOSTS = ["10.212.156.12", "192.168.10.1"]


def detect_reachable_router() -> str:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return sys.argv[1].strip()
    for ip in CANDIDATE_HOSTS:
        try:
            with socket.create_connection((ip, 22), timeout=2.5):
                return ip
        except Exception:
            pass
    return CANDIDATE_HOSTS[0]


def main():
    host = detect_reachable_router()
    print(f"[*] Target Router IP: {host} (WireGuard primary: 10.212.156.12 / LAN: 192.168.10.1)")

    mkdir_cmd = "mkdir -p /etc/nxmodbus/web/css /etc/nxmodbus/web/js"
    subprocess.run([PLINK, "-batch", "-hostkey", HOSTKEY, "-l", "root", "-pw", PASS, host, mkdir_cmd], check=True)

    files = [
        ("router_app/ch348_driver.py", "/etc/nxmodbus/ch348_driver.py"),
        ("router_app/sd_profile_manager.py", "/etc/nxmodbus/sd_profile_manager.py"),
        ("router_app/nxmodbus_server.py", "/etc/nxmodbus/nxmodbus_server.py"),
        ("router_app/web/index.html", "/etc/nxmodbus/web/index.html"),
        ("router_app/web/css/studio.css", "/etc/nxmodbus/web/css/studio.css"),
        ("router_app/web/js/app_core.js", "/etc/nxmodbus/web/js/app_core.js"),
        ("router_app/web/js/scanner_gateway_datalog.js", "/etc/nxmodbus/web/js/scanner_gateway_datalog.js"),
        ("router_app/web/js/profile_studio_and_builder.js", "/etc/nxmodbus/web/js/profile_studio_and_builder.js"),
    ]

    for src, dst in files:
        cmd = [PSCP, "-scp", "-batch", "-hostkey", HOSTKEY, "-pw", PASS, src, f"root@{host}:{dst}"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print("ERROR uploading", src, ":", res.stderr)
            raise SystemExit(1)
        print(f"Uploaded {src} -> {host}:{dst}")

    restart_cmd = "/etc/init.d/nxmodbus restart && sleep 3 && ps | grep nxmodbus_server"
    res = subprocess.run([PLINK, "-batch", "-hostkey", HOSTKEY, "-l", "root", "-pw", PASS, host, restart_cmd], capture_output=True, text=True)
    print("Router process:\n" + res.stdout.strip())

    for path in [
        "/",
        "/css/studio.css",
        "/js/app_core.js",
        "/js/scanner_gateway_datalog.js",
        "/js/profile_studio_and_builder.js",
        "/api/status",
        "/api/profile/list",
    ]:
        url = f"http://{host}:8098{path}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = resp.read()
            print(f"GET {url:52s} -> HTTP {resp.status} ({len(body):6d} bytes)")


if __name__ == "__main__":
    main()
