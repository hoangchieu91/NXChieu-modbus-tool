#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NXChieu Modbus Studio Pro v3.2 for GL.iNet GL-XE300 / OpenWrt
Multi-Port Concurrent Modbus RTU/TCP Engine, WCH CH348 8-Port Hub Multiplexer,
Instant USB Hotplug/Rescan, Smart Unified TCP Router (Virtual ID Remapping),
COM-to-COM RS485 Baudrate Converter, Multi-COM AI Datalogger & JSON Profile Engine.
"""

import os
import sys
import time
import json
import struct
import socket
import select
import sqlite3
import threading
import http.server
import socketserver
import urllib.parse
from datetime import datetime

# Ensure local directory is in sys.path for procd init startup
BASE_APP_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_APP_DIR not in sys.path:
    sys.path.insert(0, BASE_APP_DIR)

try:
    import serial
except ImportError:
    serial = None

try:
    from ch348_driver import ch348_hub, CH348VirtualSerial
except Exception as _ch348_err:
    print(f"[!] CH348 driver import warning: {_ch348_err}")
    ch348_hub = None
    CH348VirtualSerial = None

PORT_WEB = 8098
DEFAULT_SERIAL = "/dev/ttyUSB1" if os.path.exists("/dev/ttyUSB1") else "/dev/ttyUSB0"
DEFAULT_BAUD = 9600
SD_DATA_DIR = "/mnt/sda1/modbus_data"
FALLBACK_DATA_DIR = "/tmp/modbus_data"
PERSIST_CFG_PATH = "/etc/nxmodbus/multiport_config.json" if os.path.isdir("/etc/nxmodbus") else "/tmp/nxmodbus_multiport_config.json"

USB_CHIP_NAMES = {
    "0403": "FTDI USB-RS485",
    "1a86": "WCH CH340/CH341",
    "10c4": "Silicon Labs CP210x",
    "067b": "Prolific PL2303",
    "0483": "STM32 Virtual COM",
    "303a": "ESP32-S3 USB Serial",
}


# ==================== CRC16 MODBUS ====================
def calc_crc(data: bytes) -> bytes:
    crc = 0xFFFF
    for pos in data:
        crc ^= pos
        for _ in range(8):
            if (crc & 1) != 0:
                crc >>= 1
                crc ^= 0xA001
            else:
                crc >>= 1
    return struct.pack('<H', crc)


def check_crc(data: bytes) -> bool:
    if len(data) < 3:
        return False
    return calc_crc(data[:-2]) == data[-2:]


def to_hex_spaced(b: bytes) -> str:
    return " ".join(f"{x:02X}" for x in b)


def format_port_short(port: str) -> str:
    if not port:
        return ""
    p_low = port.lower()
    if p_low.startswith("tcp://"):
        return f"TCP {port[6:]}"
    if p_low.startswith("rtuovertcp://"):
        return f"RTU-TCP {port[13:]}"
    if p_low.startswith("rtu_tcp://"):
        return f"RTU-TCP {port[10:]}"
    if port.startswith("/dev/ttyCH"):
        try:
            idx = int(port.replace("/dev/ttyCH", ""))
            return f"COM{idx + 1}"
        except Exception:
            pass
    return port.replace("/dev/", "")


def is_tcp_endpoint(port: str) -> bool:
    if not port or not isinstance(port, str):
        return False
    p_low = port.strip().lower()
    return p_low.startswith(("tcp://", "rtuovertcp://", "rtu_tcp://"))


def parse_tcp_endpoint(port: str):
    """Phân giải chuỗi tcp://host:port hoặc rtuovertcp://host:port -> (proto, host, tcp_port)."""
    raw = (port or "").strip()
    p_low = raw.lower()
    proto = "tcp"
    if p_low.startswith("rtuovertcp://"):
        proto = "rtuovertcp"
        rest = raw[13:]
    elif p_low.startswith("rtu_tcp://"):
        proto = "rtuovertcp"
        rest = raw[10:]
    elif p_low.startswith("tcp://"):
        proto = "tcp"
        rest = raw[6:]
    else:
        rest = raw
    rest = rest.strip().rstrip("/")
    if ":" in rest:
        host_part, port_part = rest.rsplit(":", 1)
        try:
            tcp_port = int(port_part)
        except Exception:
            tcp_port = 502
    else:
        host_part = rest
        tcp_port = 502
    return proto, host_part.strip() or "127.0.0.1", max(1, min(65535, tcp_port))


def resolve_req_endpoint(req: dict, default_port: str) -> str:
    """Chuẩn hóa cổng đích từ payload JSON (hỗ trợ cả port='tcp://...' hoặc conn_type='tcp', host='...', tcp_port=502)."""
    if not isinstance(req, dict):
        return default_port
    port = str(req.get("port") or "").strip()
    conn_type = str(req.get("conn_type") or req.get("protocol") or "").strip().lower()
    host = str(req.get("tcp_host") or req.get("host") or "").strip()
    tcp_port = req.get("tcp_port")
    if is_tcp_endpoint(port):
        return port
    if conn_type in ("tcp", "modbus_tcp", "mbap") and host:
        return f"tcp://{host}:{int(tcp_port or 502)}"
    if conn_type in ("rtuovertcp", "rtu_over_tcp", "rtu_tcp") and host:
        return f"rtuovertcp://{host}:{int(tcp_port or 502)}"
    return port or default_port


# ==================== SMART SERIAL PORT DISCOVERY & USB HOTPLUG ====================
def get_tty_usb_info(tty_name: str):
    """Đọc VID:PID và tên chip thực tế từ sysfs để loại trừ Modem 4G Quectel (2c7c) và hiển thị đúng tên cáp USB."""
    sys_tty = f"/sys/class/tty/{tty_name}/device"
    if not os.path.exists(sys_tty):
        return None, None, ""
    try:
        cur = os.path.realpath(sys_tty)
        for _ in range(5):
            vid_f = os.path.join(cur, "idVendor")
            pid_f = os.path.join(cur, "idProduct")
            if os.path.exists(vid_f) and os.path.exists(pid_f):
                vid = open(vid_f).read().strip().lower()
                pid = open(pid_f).read().strip().lower()
                prod = ""
                prod_f = os.path.join(cur, "product")
                if os.path.exists(prod_f):
                    try:
                        prod = open(prod_f).read().strip()
                    except Exception:
                        pass
                chip = USB_CHIP_NAMES.get(vid, prod or f"USB {vid}:{pid}")
                return vid, pid, chip
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    except Exception:
        pass
    return None, None, ""


def discover_serial_ports():
    """Trả về danh sách toàn bộ cổng RS485/COM khả dụng kèm Bí danh (Port Alias) do người dùng/AI đặt."""
    ports = []
    aliases = state.port_aliases if 'state' in globals() else {}

    # 1. Bộ chuyển đổi USB sang 8 cổng COM (WCH CH348L / CH348Q)
    if ch348_hub is not None and ch348_hub.online:
        for i in range(8):
            dev_id = f"/dev/ttyCH{i}"
            alias = aliases.get(dev_id, "").strip()
            alias_suffix = f" [{alias}]" if alias else ""
            p_st = ch348_hub.ports[i]
            ports.append({
                "id": dev_id,
                "label": f"COM {i + 1}{alias_suffix} — {dev_id} ({ch348_hub.chip_type} #{i + 1})",
                "short_label": f"COM {i + 1}",
                "alias": alias,
                "com_index": i + 1,
                "default_tcp_port": 5001 + i,
                "chip": ch348_hub.chip_type,
                "framing": f"{p_st.baudrate} 8{p_st.parity}{p_st.stopbits}",
                "is_ch348": True,
                "is_external": True
            })

    # 2. Các cáp USB-to-RS485 đơn lẻ (/dev/ttyUSB1+, /dev/ttyACM*, loại trừ Modem 4G Quectel 2c7c:*)
    try:
        dev_entries = sorted(os.listdir("/dev"))
    except Exception:
        dev_entries = []

    ordered_ttys = []
    if "ttyUSB1" in dev_entries:
        ordered_ttys.append("ttyUSB1")
    for p in dev_entries:
        if (p.startswith("ttyUSB") or p.startswith("ttyACM")) and p not in ("ttyUSB0", "ttyUSB1"):
            ordered_ttys.append(p)

    ext_tcp_seq = 5009
    for p in ordered_ttys:
        vid, pid, chip_desc = get_tty_usb_info(p)
        if vid == "2c7c":
            continue
        dev_id = f"/dev/{p}"
        alias = aliases.get(dev_id, "").strip()
        alias_suffix = f" [{alias}]" if alias else ""
        desc = chip_desc or "Cáp USB-RS485 Cắm Ngoài"
        tcp_def = 5000 if p == "ttyUSB1" else ext_tcp_seq
        if p != "ttyUSB1":
            ext_tcp_seq += 1
        ports.append({
            "id": dev_id,
            "label": f"{dev_id}{alias_suffix} ({desc})",
            "short_label": p,
            "alias": alias,
            "default_tcp_port": tcp_def,
            "chip": desc,
            "is_ch348": False,
            "is_external": True
        })

    # 3. Cổng MCU nội bộ của GL-XE300 hoặc cổng USB0 trên Ubuntu/Linux PC
    if os.path.exists("/dev/ttyUSB0"):
        is_openwrt_xe300 = os.path.exists("/etc/openwrt_release")
        vid0, pid0, chip0 = get_tty_usb_info("ttyUSB0")
        if is_openwrt_xe300:
            ports.append({
                "id": "/dev/ttyUSB0",
                "label": "/dev/ttyUSB0 (MCU Pin/Nguồn Onboard GL-XE300 — Không cắm RS485)",
                "short_label": "ttyUSB0 (MCU)",
                "alias": "MCU Onboard",
                "default_tcp_port": 5015,
                "chip": "GL-XE300 MCU",
                "is_ch348": False,
                "is_external": False
            })
        else:
            dev_id = "/dev/ttyUSB0"
            alias = aliases.get(dev_id, "").strip()
            alias_suffix = f" [{alias}]" if alias else ""
            desc = chip0 or "USB-RS485 Adapter"
            ports.insert(0, {
                "id": dev_id,
                "label": f"{dev_id}{alias_suffix} ({desc})",
                "short_label": "ttyUSB0",
                "alias": alias,
                "default_tcp_port": 5000,
                "chip": desc,
                "is_ch348": False,
                "is_external": True
            })

    # 4. Hỗ trợ Windows COM1..COM256 (khi chạy nxmodbus_server.py trực tiếp trên Windows PC)
    if os.name == "nt":
        try:
            import serial.tools.list_ports
            for idx, cp in enumerate(serial.tools.list_ports.comports()):
                dev_id = cp.device
                alias = aliases.get(dev_id, "").strip()
                alias_suffix = f" [{alias}]" if alias else ""
                desc = cp.description or "Windows Serial Port"
                ports.append({
                    "id": dev_id,
                    "label": f"{dev_id}{alias_suffix} ({desc})",
                    "short_label": dev_id,
                    "alias": alias,
                    "default_tcp_port": 5001 + idx,
                    "chip": desc,
                    "is_ch348": False,
                    "is_external": True
                })
        except Exception:
            pass

    return ports


# ==================== STORAGE, SD CARD PROFILES & DATABASE ====================
from sd_profile_manager import (
    get_storage_dir,
    get_profiles_dir,
    sanitize_profile_filename,
    save_sd_profile_file,
    list_sd_profiles,
    load_sd_profile_file,
    delete_sd_profile_file,
    parse_addr_set,
    format_addr_ranges,
    is_tag_map_address_keyed,
    build_safe_sub_blocks,
    analyze_sd_profile_dict,
)


def init_db():
    sdir = get_storage_dir()
    db_path = os.path.join(sdir, "nxmodbus_datalog.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS datalog_sessions (
            id TEXT PRIMARY KEY,
            name TEXT,
            started_at TEXT,
            stopped_at TEXT,
            interval_sec INTEGER,
            is_active INTEGER,
            point_count INTEGER,
            sample_count INTEGER,
            csv_path TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS datalog_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            timestamp TEXT,
            address INTEGER,
            value REAL,
            raw_hex TEXT
        )
    """)
    conn.commit()
    conn.close()
    return db_path


# ==================== NETWORK INTERFACES DISCOVERY ====================
def get_network_interfaces():
    ifaces = []
    try:
        out = os.popen("/sbin/ip -br addr").read()
        active_gws = state.get_gateways_list() if 'state' in globals() else []
        sr_active = (state.smart_router and state.smart_router.running) if 'state' in globals() else False
        primary_gw_port = state.smart_router.tcp_port if sr_active else (
            active_gws[0]["tcp_port"] if active_gws else (state.gateway_port if 'state' in globals() else 5000)
        )
        port_range_hint = ""
        if len(active_gws) > 1:
            tcp_ports = sorted(g["tcp_port"] for g in active_gws)
            port_range_hint = f"{tcp_ports[0]}..{tcp_ports[-1]}"
            if sr_active:
                port_range_hint = f"{state.smart_router.tcp_port}, {port_range_hint}"

        for line in out.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 3:
                dev = parts[0]
                status = parts[1]
                ip_with_mask = parts[2]
                ip = ip_with_mask.split("/")[0]
                if dev == "lo":
                    continue

                itype = "other"
                label = dev
                desc = ""
                badge_color = "slate"

                if dev in ("br-lan", "wlan0"):
                    itype = "wifi_lan"
                    label = "Wi-Fi & LAN Nội Bộ (br-lan)"
                    desc = "Dành cho PC, Laptop, Điện thoại kết nối trực tiếp Wi-Fi router"
                    badge_color = "cyan"
                elif dev == "wlan-sta":
                    itype = "wifi_wan"
                    label = "Wi-Fi Repeater / Station (wlan-sta)"
                    desc = "Dành cho máy tính kết nối từ mạng Wi-Fi mẹ trong nhà/văn phòng"
                    badge_color = "emerald"
                elif dev in ("eth0", "eth1"):
                    itype = "wan_eth"
                    label = f"Cổng Mạng WAN Dây ({dev})"
                    desc = "Dành cho mạng văn phòng / Modem Internet cắm dây cáp"
                    badge_color = "amber"
                elif dev.startswith("wg") or "wireguard" in dev.lower():
                    itype = "wireguard"
                    label = f"Mạng Riêng Ảo WireGuard ({dev})"
                    desc = "Dành cho kỹ sư kết nối từ xa mọi lúc mọi nơi qua VPN an toàn"
                    badge_color = "purple"
                elif dev in ("wwan0", "3g-wan", "usb0") or "lte" in dev.lower():
                    itype = "cellular"
                    label = "Mạng Di Động 4G LTE (wwan0)"
                    desc = "Dành cho giám sát từ xa qua địa chỉ IP SIM 4G"
                    badge_color = "rose"

                gw_ep = f"{ip}:{port_range_hint}" if port_range_hint else f"{ip}:{primary_gw_port}"
                ifaces.append({
                    "device": dev,
                    "status": status,
                    "ip": ip,
                    "cidr": ip_with_mask,
                    "type": itype,
                    "label": label,
                    "description": desc,
                    "badge_color": badge_color,
                    "gw_endpoint": gw_ep,
                    "single_gw_endpoint": f"{ip}:{primary_gw_port}",
                    "web_endpoint": f"http://{ip}:{PORT_WEB}"
                })
    except Exception:
        pass
    return ifaces


# ==================== GATEWAY, SMART ROUTER & COM-TO-COM INSTANCES ====================
class GatewayInstance:
    def __init__(self, serial_port: str, tcp_port: int, baud: int = 9600, parity: str = "N", stopbits: int = 1):
        self.serial_port = serial_port
        self.com_label = format_port_short(serial_port)
        self.tcp_port = int(tcp_port)
        self.baud = int(baud)
        self.parity = (parity or "N").upper()
        self.stopbits = int(stopbits or 1)
        self.running = False
        self.stop_evt = threading.Event()
        self.thread = None
        self.stats = {
            "active_clients": 0,
            "packets_bridged": 0,
            "bytes_tx": 0,
            "bytes_rx": 0,
            "last_latency_ms": 0,
            "errors": 0
        }

    def to_dict(self):
        return {
            "serial_port": self.serial_port,
            "com_label": self.com_label,
            "tcp_port": self.tcp_port,
            "baud": self.baud,
            "parity": self.parity,
            "stopbits": self.stopbits,
            "framing": f"{self.baud} 8{self.parity}{self.stopbits}",
            "running": self.running,
            "stats": dict(self.stats)
        }


class SmartRouterInstance:
    """Gộp 8 cổng COM vào 1 cổng TCP duy nhất (:5000) — Hỗ trợ Dịch Địa Chỉ Chống Trùng ID hoặc Bảng Định Tuyến."""
    def __init__(self, tcp_port: int = 5000, mode: str = "virtual_id",
                 base_unit_id: int = 1, real_slave_id: int = 1,
                 port_configs: list = None, routes: list = None):
        self.tcp_port = int(tcp_port)
        self.mode = mode  # "virtual_id" or "route_table"
        self.base_unit_id = int(base_unit_id)
        self.real_slave_id = int(real_slave_id)
        self.port_configs = port_configs or [
            {"port": f"/dev/ttyCH{i}", "baud": 9600, "parity": "N", "stopbits": 1}
            for i in range(8)
        ]
        self.routes = routes or []
        self.running = False
        self.stop_evt = threading.Event()
        self.thread = None
        self.stats = {
            "active_clients": 0,
            "packets_routed": 0,
            "last_latency_ms": 0,
            "errors": 0
        }

    def get_involved_ports(self):
        if self.mode == "virtual_id":
            return [c["port"] for c in self.port_configs if c.get("port")]
        return list(set(r["port"] for r in self.routes if r.get("port")))

    def to_dict(self):
        return {
            "running": self.running,
            "tcp_port": self.tcp_port,
            "mode": self.mode,
            "base_unit_id": self.base_unit_id,
            "real_slave_id": self.real_slave_id,
            "port_configs": self.port_configs,
            "routes": self.routes,
            "stats": dict(self.stats)
        }


class ComBridgeInstance:
    """Cầu nối phần cứng giữa 2 cổng COM bất kỳ — Chuyển đổi Baudrate & Khung truyền RS485 thời gian thực."""
    def __init__(self, bridge_id: str, master_port: str, master_baud: int, master_parity: str, master_stopbits: int,
                 slave_port: str, slave_baud: int, slave_parity: str, slave_stopbits: int):
        self.id = bridge_id
        self.master_port = master_port
        self.master_baud = int(master_baud)
        self.master_parity = (master_parity or "N").upper()
        self.master_stopbits = int(master_stopbits or 1)
        self.slave_port = slave_port
        self.slave_baud = int(slave_baud)
        self.slave_parity = (slave_parity or "N").upper()
        self.slave_stopbits = int(slave_stopbits or 1)
        self.running = False
        self.stop_evt = threading.Event()
        self.thread = None
        self.stats = {
            "frames_converted": 0,
            "last_latency_ms": 0,
            "errors": 0
        }

    def to_dict(self):
        return {
            "id": self.id,
            "running": self.running,
            "master_port": self.master_port,
            "master_label": format_port_short(self.master_port),
            "master_framing": f"{self.master_baud} 8{self.master_parity}{self.master_stopbits}",
            "master_baud": self.master_baud,
            "master_parity": self.master_parity,
            "master_stopbits": self.master_stopbits,
            "slave_port": self.slave_port,
            "slave_label": format_port_short(self.slave_port),
            "slave_framing": f"{self.slave_baud} 8{self.slave_parity}{self.slave_stopbits}",
            "slave_baud": self.slave_baud,
            "slave_parity": self.slave_parity,
            "slave_stopbits": self.slave_stopbits,
            "stats": dict(self.stats)
        }


# ==================== GLOBAL MULTI-PORT APP STATE ====================
class AppState:
    def __init__(self):
        self.meta_lock = threading.Lock()
        self.port_locks = {}
        self.serial_pool = {}
        self.traffic_lock = threading.Lock()

        self.serial_port = DEFAULT_SERIAL
        self.baudrate = DEFAULT_BAUD
        self.parity = 'N'
        self.stopbits = 1

        # Persistent Customization
        self.port_aliases = {}
        self.auto_start_gateways = False
        self.saved_gateways = []
        self.saved_polling_tabs = []
        self.active_profile_name = ""

        # Multi-Port Gateway Pool, Smart Router & COM-to-COM Bridges
        self.gateways = {}
        self.gateway_port = 5000
        self.smart_router = None
        self.com_bridges = {}

        self.traffic_log = []

        # Datalogger state & RAM Wear-Leveling Buffer
        self.logger_running = False
        self.current_session_id = None
        self.logger_thread = None
        self.logger_stop_evt = threading.Event()
        self.datalog_buffer_lock = threading.Lock()
        self.datalog_csv_buffer = []
        self.datalog_jsonl_buffer = []
        self.datalog_db_buffer = []
        self.datalog_live_points = []
        self.datalog_batch_size = 30
        self.datalog_max_flush_sec = 60
        self.datalog_last_flush = time.time()
        self.datalog_buffered_count = 0
        self.logger_config = {
            "name": "Overnight Log",
            "port": DEFAULT_SERIAL,
            "baud": DEFAULT_BAUD,
            "parity": "N",
            "stopbits": 1,
            "interval_sec": 2,
            "slave_id": 1,
            "start_addr": 0,
            "count": 10,
            "fn_code": 3,
            "batch_size": 30,
            "channels": []
        }

    def load_persistent_config(self):
        sd_active_path = os.path.join(get_storage_dir(), "active_profile.json")
        target_path = sd_active_path if os.path.exists(sd_active_path) else PERSIST_CFG_PATH
        if not os.path.exists(target_path):
            return
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data.get("port_aliases"), dict):
                self.port_aliases = data["port_aliases"]
            self.auto_start_gateways = bool(data.get("auto_start_gateways", False))
            if isinstance(data.get("saved_gateways"), list):
                self.saved_gateways = data["saved_gateways"]
            if isinstance(data.get("saved_polling_tabs"), list):
                self.saved_polling_tabs = data["saved_polling_tabs"]
            self.active_profile_name = data.get("active_profile_name", "")
            # Tự động sao lưu hồ sơ đang chạy vào kho Thẻ nhớ SD nếu chưa có
            if self.saved_polling_tabs and self.active_profile_name:
                pdir = get_profiles_dir()
                fname = sanitize_profile_filename(self.active_profile_name)
                if not os.path.exists(os.path.join(pdir, fname)):
                    save_sd_profile_file({
                        "profile_name": self.active_profile_name,
                        "port_aliases": self.port_aliases,
                        "polling_tabs": self.saved_polling_tabs,
                        "datalogger": self.logger_config,
                        "gateways": {"auto_start_on_boot": self.auto_start_gateways, "ports": self.saved_gateways}
                    })
        except Exception as e:
            print(f"[!] Load persistent config warning: {e}")

    def save_persistent_config(self, also_save_sd_profile: bool = True):
        try:
            os.makedirs(os.path.dirname(PERSIST_CFG_PATH), exist_ok=True)
            if self.auto_start_gateways:
                self.saved_gateways = [
                    {
                        "port": g.serial_port,
                        "tcp_port": g.tcp_port,
                        "baud": g.baud,
                        "parity": g.parity,
                        "stopbits": g.stopbits
                    }
                    for g in self.gateways.values() if g.running
                ]
            payload = {
                "port_aliases": self.port_aliases,
                "auto_start_gateways": self.auto_start_gateways,
                "saved_gateways": self.saved_gateways,
                "saved_polling_tabs": self.saved_polling_tabs,
                "active_profile_name": self.active_profile_name or "NXChieu_MultiPort_Profile",
                "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            with open(PERSIST_CFG_PATH, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
            # Ghi bền vững xuống thẻ nhớ SD (/mnt/sda1/modbus_data/active_profile.json)
            sd_active_path = os.path.join(get_storage_dir(), "active_profile.json")
            with open(sd_active_path, "w", encoding="utf-8") as sf:
                json.dump(payload, sf, indent=2, ensure_ascii=False)
                sf.flush()
            if also_save_sd_profile and self.saved_polling_tabs:
                save_sd_profile_file({
                    "profile_name": self.active_profile_name or "NXChieu_MultiPort_Profile",
                    "port_aliases": self.port_aliases,
                    "polling_tabs": self.saved_polling_tabs,
                    "datalogger": self.logger_config,
                    "gateways": {"auto_start_on_boot": self.auto_start_gateways, "ports": self.saved_gateways}
                })
        except Exception as e:
            print(f"[!] Save persistent config warning: {e}")

    def get_port_lock(self, port: str) -> threading.Lock:
        port = port or self.serial_port
        with self.meta_lock:
            lk = self.port_locks.get(port)
            if lk is None:
                lk = threading.Lock()
                self.port_locks[port] = lk
            return lk

    @property
    def gateway_running(self) -> bool:
        with self.meta_lock:
            gw_on = any(g.running for g in self.gateways.values())
            sr_on = bool(self.smart_router and self.smart_router.running)
            return gw_on or sr_on

    @property
    def gateway_stats(self) -> dict:
        with self.meta_lock:
            active = [g for g in self.gateways.values() if g.running]
            sr = self.smart_router if (self.smart_router and self.smart_router.running) else None
        clients = sum(g.stats["active_clients"] for g in active) + (sr.stats["active_clients"] if sr else 0)
        pkts = sum(g.stats["packets_bridged"] for g in active) + (sr.stats["packets_routed"] if sr else 0)
        b_tx = sum(g.stats["bytes_tx"] for g in active)
        b_rx = sum(g.stats["bytes_rx"] for g in active)
        lats = [g.stats["last_latency_ms"] for g in active] + ([sr.stats["last_latency_ms"]] if sr else [])
        errs = sum(g.stats["errors"] for g in active) + (sr.stats["errors"] if sr else 0)
        return {
            "active_clients": clients,
            "packets_bridged": pkts,
            "bytes_tx": b_tx,
            "bytes_rx": b_rx,
            "last_latency_ms": max(lats) if lats else 0,
            "errors": errs,
            "active_gateways": len(active) + (1 if sr else 0)
        }

    def get_gateways_list(self):
        with self.meta_lock:
            return [g.to_dict() for g in sorted(self.gateways.values(), key=lambda x: x.tcp_port) if g.running]

    def get_smart_router_status(self):
        with self.meta_lock:
            if self.smart_router and self.smart_router.running:
                return self.smart_router.to_dict()
            return {"running": False, "tcp_port": 5000, "mode": "virtual_id"}

    def get_com_bridges_list(self):
        with self.meta_lock:
            return [b.to_dict() for b in self.com_bridges.values() if b.running]

    def get_port_busy_reason(self, port: str):
        """Kiểm tra cổng COM có đang bị chiếm độc quyền bởi Gateway hoặc COM-to-COM Converter không."""
        if is_tcp_endpoint(port):
            return None
        with self.meta_lock:
            g = self.gateways.get(port)
            if g and g.running:
                return f"Cổng {format_port_short(port)} đang chạy Cầu nối TCP Gateway (:{g.tcp_port}). Hãy tắt Gateway trên cổng này, hoặc chọn 'tcp://127.0.0.1:{g.tcp_port}' để đọc xuyên qua Gateway!"
            for b in self.com_bridges.values():
                if b.running and port in (b.master_port, b.slave_port):
                    return f"Cổng {format_port_short(port)} đang chạy Cầu nối Chuyển đổi tốc độ RS485 ({format_port_short(b.master_port)} ↔ {format_port_short(b.slave_port)})."
        return None

    def get_active_gateway_on_port(self, port: str):
        with self.meta_lock:
            g = self.gateways.get(port)
            if g and g.running:
                return g
            return None

    def log_traffic(self, direction, hex_str, latency=0, note="", port=""):
        p_short = format_port_short(port) if port else ""
        with self.traffic_lock:
            entry = {
                "time": datetime.now().strftime("%H:%M:%S.%f")[:-3],
                "dir": direction,
                "port": p_short,
                "hex": hex_str,
                "latency": latency,
                "note": note
            }
            self.traffic_log.append(entry)
            if len(self.traffic_log) > 250:
                self.traffic_log.pop(0)

    def acquire_serial(self, port=None, baud=None, timeout=0.8, parity=None, stopbits=None):
        port = port or self.serial_port
        baud = int(baud or self.baudrate)
        parity = (parity or getattr(self, "parity", "N")).upper()
        stopbits = int(stopbits or getattr(self, "stopbits", 1))

        if port.startswith("/dev/ttyCH") and ch348_hub is not None and CH348VirtualSerial is not None:
            p_idx = int(port.replace("/dev/ttyCH", ""))
            with self.meta_lock:
                existing = self.serial_pool.get(port)
            if existing is not None and getattr(existing, "is_open", False):
                existing.reconfigure(baud, parity, stopbits, timeout=timeout)
                return existing
            ser_obj = CH348VirtualSerial(
                ch348_hub, p_idx, baudrate=baud, parity=parity, stopbits=stopbits, timeout=timeout
            )
            with self.meta_lock:
                self.serial_pool[port] = ser_obj
            return ser_obj

        p_const = serial.PARITY_NONE
        if parity == 'E':
            p_const = serial.PARITY_EVEN
        elif parity == 'O':
            p_const = serial.PARITY_ODD
        sb_const = serial.STOPBITS_ONE if stopbits == 1 else serial.STOPBITS_TWO

        with self.meta_lock:
            existing = self.serial_pool.get(port)

        if existing is not None and getattr(existing, "is_open", False):
            if (existing.port == port and existing.baudrate == baud and
                    existing.parity == p_const and existing.stopbits == sb_const):
                existing.timeout = timeout
                return existing
            try:
                existing.close()
            except Exception:
                pass

        ser_obj = serial.Serial(
            port=port,
            baudrate=baud,
            bytesize=serial.EIGHTBITS,
            parity=p_const,
            stopbits=sb_const,
            timeout=timeout,
            inter_byte_timeout=0.04
        )
        with self.meta_lock:
            self.serial_pool[port] = ser_obj
        return ser_obj

    def close_serial(self, port=None):
        with self.meta_lock:
            if port:
                s = self.serial_pool.pop(port, None)
                to_close = [s] if s else []
            else:
                to_close = list(self.serial_pool.values())
                self.serial_pool.clear()
        for s in to_close:
            if s and getattr(s, "is_open", False):
                try:
                    s.close()
                except Exception:
                    pass

    def cleanup_unplugged_serials(self):
        with self.meta_lock:
            stale = [
                p for p in list(self.serial_pool.keys())
                if not p.startswith("/dev/ttyCH") and not os.path.exists(p)
            ]
        for p in stale:
            self.close_serial(p)


state = AppState()


# ==================== MODBUS RTU FRAME PARSERS ====================
def read_rtu_frame(ser):
    """Đọc khung phản hồi Modbus RTU Slave, tự động lọc nhiễu 0x00 khi đảo chiều DE/RE RS485."""
    first = b''
    for _ in range(6):
        b1 = ser.read(1)
        if not b1:
            return b''
        if b1 != b'\x00':
            first = b1
            break
    if not first:
        return b''

    rest_hdr = ser.read(2)
    if len(rest_hdr) < 2:
        return first + rest_hdr

    header = first + rest_hdr
    resp = header
    resp_fn = header[1]
    if resp_fn >= 0x80:
        resp += ser.read(2)
    elif resp_fn in (1, 2, 3, 4):
        byte_count = header[2]
        resp += ser.read(byte_count + 2)
    elif resp_fn in (5, 6, 15, 16):
        resp += ser.read(5)
    else:
        time.sleep(0.02)
        if ser.in_waiting > 0:
            resp += ser.read(ser.in_waiting)
    return resp


def read_rtu_master_request(ser):
    """Đọc khung yêu cầu từ một Modbus RTU Master bên ngoài (dùng cho COM-to-COM Baud Converter)."""
    first = b''
    for _ in range(6):
        b1 = ser.read(1)
        if not b1:
            return b''
        if b1 != b'\x00':
            first = b1
            break
    if not first:
        return b''

    fn_b = ser.read(1)
    if not fn_b:
        return b''
    fn_code = fn_b[0]
    if fn_code in (1, 2, 3, 4, 5, 6):
        tail = ser.read(6)
        return first + fn_b + tail
    elif fn_code in (15, 16):
        hdr5 = ser.read(5)
        if len(hdr5) < 5:
            return first + fn_b + hdr5
        byte_cnt = hdr5[4]
        tail = ser.read(byte_cnt + 2)
        return first + fn_b + hdr5 + tail
    else:
        time.sleep(0.02)
        rem = ser.read(max(6, ser.in_waiting))
        return first + fn_b + rem


# ==================== CONCURRENT PER-PORT MODBUS RTU & TCP ENGINE ====================
_tcp_txn_counter = 0
_tcp_txn_lock = threading.Lock()


def _next_mbap_txn_id() -> int:
    global _tcp_txn_counter
    with _tcp_txn_lock:
        _tcp_txn_counter = (_tcp_txn_counter + 1) & 0xFFFF
        if _tcp_txn_counter == 0:
            _tcp_txn_counter = 1
        return _tcp_txn_counter


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def modbus_tcp_transceive(endpoint_url: str, request_pdu: bytes, timeout=0.8):
    """
    Thực thi giao dịch Modbus TCP (MBAP 7-byte Header) hoặc Modbus RTU over TCP (kèm CRC16).
    Hỗ trợ kết nối tới bất kỳ PLC / Biến tần / Đồng hồ IP:Port nào hoặc tự test vòng lặp Gateway nội bộ.
    """
    proto, host, tcp_port = parse_tcp_endpoint(endpoint_url)
    norm_ep = f"{proto}://{host}:{tcp_port}"
    ep_lock = state.get_port_lock(norm_ep)

    with ep_lock:
        t0 = time.time()
        sock = None
        try:
            sock = socket.create_connection((host, tcp_port), timeout=max(0.15, float(timeout)))
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.settimeout(max(0.15, float(timeout)))

            if proto == "rtuovertcp":
                frame = request_pdu + calc_crc(request_pdu)
                tx_hex = to_hex_spaced(frame)
                state.log_traffic("TX", tx_hex, 0, f"RTU-TCP Slave {request_pdu[0]} Fn {request_pdu[1]}", port=norm_ep)
                sock.sendall(frame)

                hdr3 = _recv_exact(sock, 3)
                if not hdr3:
                    elapsed = int((time.time() - t0) * 1000)
                    state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] Timeout (Không có phản hồi RTU-TCP)", elapsed, port=norm_ep)
                    raise TimeoutError(f"[{format_port_short(norm_ep)}] Thiết bị không phản hồi (Timeout)")
                if len(hdr3) < 3:
                    raise ValueError(f"Khung RTU-TCP quá ngắn ({len(hdr3)}B)")
                resp_fn = hdr3[1]
                if resp_fn >= 0x80:
                    tail = _recv_exact(sock, 2)
                elif resp_fn in (1, 2, 3, 4):
                    tail = _recv_exact(sock, hdr3[2] + 2)
                elif resp_fn in (5, 6, 15, 16):
                    tail = _recv_exact(sock, 5)
                else:
                    tail = sock.recv(256)
                resp = hdr3 + tail
                elapsed = int((time.time() - t0) * 1000)
                rx_hex = to_hex_spaced(resp)
                if len(resp) < 4 or not check_crc(resp):
                    state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] Lỗi CRC16 RTU-TCP: {rx_hex}", elapsed, port=norm_ep)
                    raise ValueError(f"Lỗi CRC16 RTU-over-TCP: nhận {rx_hex}")
                pdu = resp[:-2]
                state.log_traffic("RX", rx_hex, elapsed, f"RTU-TCP {len(resp)}B", port=norm_ep)
                return pdu, elapsed, tx_hex, rx_hex

            # Chuẩn Modbus TCP (MBAP Header: TxnID[2] + ProtoID=0[2] + Length[2] + PDU[UnitID + Fn + Data])
            txn_id = _next_mbap_txn_id()
            mbap_hdr = struct.pack('>HHH', txn_id, 0, len(request_pdu))
            mbap_frame = mbap_hdr + request_pdu
            tx_hex = to_hex_spaced(mbap_frame)
            state.log_traffic("TX", tx_hex, 0, f"TCP Unit {request_pdu[0]} Fn {request_pdu[1]} (Txn #{txn_id})", port=norm_ep)

            sock.sendall(mbap_frame)

            rx_hdr = _recv_exact(sock, 6)
            if not rx_hdr:
                elapsed = int((time.time() - t0) * 1000)
                state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] Timeout (Không có phản hồi MBAP)", elapsed, port=norm_ep)
                raise TimeoutError(f"[{format_port_short(norm_ep)}] Thiết bị không phản hồi (Timeout)")
            if len(rx_hdr) < 6:
                elapsed = int((time.time() - t0) * 1000)
                raise ValueError(f"MBAP Header quá ngắn ({len(rx_hdr)} bytes): {to_hex_spaced(rx_hdr)}")

            rx_txn, rx_proto, rx_len = struct.unpack('>HHH', rx_hdr)
            if rx_proto != 0 or rx_len < 2 or rx_len > 260:
                elapsed = int((time.time() - t0) * 1000)
                raise ValueError(f"MBAP Header không hợp lệ (Proto={rx_proto}, Len={rx_len})")

            pdu = _recv_exact(sock, rx_len)
            elapsed = int((time.time() - t0) * 1000)
            rx_full = rx_hdr + pdu
            rx_hex = to_hex_spaced(rx_full)
            if len(pdu) < 2:
                state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] PDU rỗng: {rx_hex}", elapsed, port=norm_ep)
                raise ValueError("PDU phản hồi Modbus TCP quá ngắn")

            state.log_traffic("RX", rx_hex, elapsed, f"MBAP {len(rx_full)}B", port=norm_ep)
            return pdu, elapsed, tx_hex, rx_hex
        except socket.timeout:
            elapsed = int((time.time() - t0) * 1000)
            state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] TCP Timeout ({elapsed}ms)", elapsed, port=norm_ep)
            raise TimeoutError(f"[{format_port_short(norm_ep)}] Hết thời gian chờ phản hồi TCP ({elapsed}ms)")
        except ConnectionRefusedError:
            elapsed = int((time.time() - t0) * 1000)
            state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] Connection Refused (Cổng đóng)", elapsed, port=norm_ep)
            raise TimeoutError(f"[{format_port_short(norm_ep)}] Từ chối kết nối (Cổng TCP {tcp_port} đang đóng)")
        except OSError as oe:
            elapsed = int((time.time() - t0) * 1000)
            state.log_traffic("ERR", f"[{format_port_short(norm_ep)}] Lỗi mạng TCP: {oe}", elapsed, port=norm_ep)
            raise TimeoutError(f"[{format_port_short(norm_ep)}] Không thể kết nối TCP ({oe})")
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass


def modbus_transceive(port, baud, request_pdu, timeout=0.8, parity=None, stopbits=None):
    port = port or state.serial_port
    if is_tcp_endpoint(port):
        return modbus_tcp_transceive(port, request_pdu, timeout=timeout)

    port_lock = state.get_port_lock(port)

    with port_lock:
        ser = state.acquire_serial(port, baud, timeout, parity=parity, stopbits=stopbits)
        ser.reset_input_buffer()
        ser.reset_output_buffer()

        frame = request_pdu + calc_crc(request_pdu)
        tx_hex = to_hex_spaced(frame)
        state.log_traffic("TX", tx_hex, 0, f"Slave {request_pdu[0]} Fn {request_pdu[1]}", port=port)

        t0 = time.time()
        ser.write(frame)
        ser.flush()

        resp = read_rtu_frame(ser)
        elapsed = int((time.time() - t0) * 1000)

        if not resp:
            state.log_traffic("ERR", f"[{format_port_short(port)}] Timeout (Không có phản hồi)", elapsed, port=port)
            raise TimeoutError(f"[{format_port_short(port)}] Thiết bị không phản hồi (Timeout)")

        rx_hex = to_hex_spaced(resp)
        if len(resp) < 4:
            state.log_traffic("ERR", f"[{format_port_short(port)}] Khung quá ngắn: {rx_hex}", elapsed, port=port)
            raise ValueError(f"Khung phản hồi quá ngắn ({len(resp)} bytes): {resp.hex()}")
        if not check_crc(resp):
            state.log_traffic("ERR", f"[{format_port_short(port)}] Lỗi CRC16: {rx_hex}", elapsed, port=port)
            raise ValueError(f"Lỗi kiểm tra CRC16: nhận {resp.hex()}")

        pdu = resp[:-2]
        state.log_traffic("RX", rx_hex, elapsed, f"Phản hồi {len(resp)}B", port=port)
        return pdu, elapsed, tx_hex, rx_hex


def probe_single_slave(port, baud, parity, stopbits, sid, fn_code, reg_addr, count, timeout_sec):
    req_pdu = struct.pack('>BBHH', sid, fn_code, reg_addr, count)
    pdu, latency, tx_hex, rx_hex = modbus_transceive(
        port, baud, req_pdu, timeout=timeout_sec, parity=parity, stopbits=stopbits
    )
    resp_sid = pdu[0]
    resp_fn = pdu[1]
    is_tcp = is_tcp_endpoint(port)
    if not is_tcp and resp_sid != sid:
        return None
    if is_tcp and resp_sid != sid and not (sid in (0, 1, 255) and resp_sid in (0, 1, 255)):
        return None

    if is_tcp:
        proto, host, tcp_p = parse_tcp_endpoint(port)
        framing_label = f"Modbus TCP ({host}:{tcp_p})" if proto == "tcp" else f"RTU-over-TCP ({host}:{tcp_p})"
    else:
        framing_label = f"{baud} 8{parity}{stopbits}"
    port_short = format_port_short(port)

    if resp_fn >= 0x80:
        exc_code = pdu[2] if len(pdu) > 2 else 0
        exc_names = {
            1: "Illegal Function (FC không hỗ trợ)",
            2: "Illegal Data Address (Địa chỉ thanh ghi không hỗ trợ)",
            3: "Illegal Data Value (Giá trị không hợp lệ)",
            4: "Slave Device Failure (Lỗi phần cứng thiết bị)"
        }
        exc_desc = exc_names.get(exc_code, f"Exception 0x{exc_code:02X}")
        return {
            "id": sid,
            "port": port,
            "port_label": port_short,
            "baud": baud,
            "parity": parity,
            "stopbits": stopbits,
            "framing": framing_label,
            "fn_code": fn_code,
            "addr": reg_addr,
            "status": "ONLINE_EXCEPTION",
            "is_online": True,
            "latency": latency,
            "detail": f"Online trên {port_short} (Mã lỗi Modbus 0x{exc_code:02X}: {exc_desc})",
            "value_display": f"[Err 0x{exc_code:02X}]",
            "raw_rx": rx_hex
        }
    else:
        val_str = ""
        val_display = ""
        if resp_fn in (3, 4) and len(pdu) >= 3:
            byte_cnt = pdu[2]
            if byte_cnt >= 2 and len(pdu) >= 5:
                val = struct.unpack_from('>H', pdu, 3)[0]
                val_str = f"Reg {reg_addr} = {val} (0x{val:04X})"
                val_display = f"{val} (0x{val:04X})"
        elif resp_fn in (1, 2) and len(pdu) >= 3:
            byte_cnt = pdu[2]
            if byte_cnt >= 1:
                bit_val = pdu[3] & 0x01
                val_str = f"Coil {reg_addr} = {bit_val}"
                val_display = str(bit_val)

        return {
            "id": sid,
            "port": port,
            "port_label": port_short,
            "baud": baud,
            "parity": parity,
            "stopbits": stopbits,
            "framing": framing_label,
            "fn_code": fn_code,
            "addr": reg_addr,
            "status": "ONLINE",
            "is_online": True,
            "latency": latency,
            "detail": f"Online chuẩn trên {port_short} (OK) - {val_str}",
            "value_display": val_display,
            "raw_rx": rx_hex
        }


def read_registers(port, baud, slave_id, fn_code, start_addr, count, parity=None, stopbits=None):
    req = struct.pack('>BBHH', slave_id, fn_code, start_addr, count)
    pdu, latency, tx_hex, rx_hex = modbus_transceive(port, baud, req, parity=parity, stopbits=stopbits)
    resp_slave, resp_fn = struct.unpack_from('>BB', pdu, 0)
    if resp_fn >= 0x80:
        err_code = pdu[2] if len(pdu) > 2 else 0
        raise RuntimeError(f"Modbus Exception: Fn=0x{resp_fn:02X}, Code=0x{err_code:02X}")
    values = []
    for i in range(count):
        idx = 3 + (i * 2)
        if idx + 2 <= len(pdu):
            val = struct.unpack_from('>H', pdu, idx)[0]
            values.append(val)
    return values, latency, tx_hex, rx_hex


def read_coils(port, baud, slave_id, fn_code, start_addr, count, parity=None, stopbits=None):
    req = struct.pack('>BBHH', slave_id, fn_code, start_addr, count)
    pdu, latency, tx_hex, rx_hex = modbus_transceive(port, baud, req, parity=parity, stopbits=stopbits)
    resp_slave, resp_fn = struct.unpack_from('>BB', pdu, 0)
    if resp_fn >= 0x80:
        err_code = pdu[2] if len(pdu) > 2 else 0
        raise RuntimeError(f"Modbus Exception: Fn=0x{resp_fn:02X}, Code=0x{err_code:02X}")
    bits = []
    for i in range(count):
        byte_idx = 3 + (i // 8)
        bit_idx = i % 8
        if byte_idx < len(pdu):
            bits.append(bool((pdu[byte_idx] >> bit_idx) & 1))
        else:
            bits.append(False)
    return bits, latency, tx_hex, rx_hex


def read_registers_smart(port, baud, slave_id, fn_code, start_addr, count,
                         parity=None, stopbits=None, disabled_addrs=None,
                         enabled_addrs=None, only_tagged=False, tags=None):
    """
    Đọc thanh ghi/coil thông minh:
    - Nếu không có địa chỉ cấm đọc và count <= 120: gửi 1 lệnh chuẩn như truyền thống.
    - Nếu có địa chỉ cấm đọc ở giữa (disabled_addrs) hoặc only_tagged=True hoặc count > 120:
      Tự động chia thành các lệnh đọc con (Sub-Blocks) né hoàn toàn các thanh ghi cấm đọc!
    - Nếu 1 khối con báo Modbus Exception (VD 0x02), vẫn giữ kết quả của các khối hợp lệ khác.
    """
    max_chunk = 120 if fn_code in (3, 4) else 1900
    sub_blocks, active_disabled = build_safe_sub_blocks(
        start_addr, count,
        disabled_addrs=disabled_addrs,
        enabled_addrs=enabled_addrs,
        only_tagged=only_tagged,
        tags=tags,
        max_chunk=max_chunk
    )

    full_values = [None] * count
    if not sub_blocks:
        return full_values, 0, "", "", [], active_disabled, {}

    total_lat = 0
    tx_list = []
    rx_list = []
    block_errors = {}
    any_success = False
    last_exc = None

    for blk_idx, blk in enumerate(sub_blocks):
        b_off = blk["offset"]
        b_addr = blk["start_addr"]
        b_cnt = blk["count"]
        try:
            if fn_code in (3, 4):
                vals, lat, tx_h, rx_h = read_registers(
                    port, baud, slave_id, fn_code, b_addr, b_cnt, parity=parity, stopbits=stopbits
                )
            else:
                bits, lat, tx_h, rx_h = read_coils(
                    port, baud, slave_id, fn_code, b_addr, b_cnt, parity=parity, stopbits=stopbits
                )
                vals = [1 if b else 0 for b in bits]

            any_success = True
            total_lat += lat
            if tx_h:
                tx_list.append(tx_h)
            if rx_h:
                rx_list.append(rx_h)
            for j, v in enumerate(vals):
                if b_off + j < count:
                    full_values[b_off + j] = v
        except TimeoutError as te:
            last_exc = te
            # Nếu ngay khối đầu tiên đã Timeout thì thiết bị đang tắt/đứt dây -> thoát ngay không chờ các khối sau
            if blk_idx == 0 and not any_success:
                raise
            for j in range(b_cnt):
                block_errors[str(b_addr + j)] = "TIMEOUT"
        except Exception as ex:
            last_exc = ex
            err_msg = str(ex)
            for j in range(b_cnt):
                block_errors[str(b_addr + j)] = err_msg

    if not any_success and last_exc is not None:
        raise last_exc

    tx_joined = "  ||  ".join(tx_list)
    rx_joined = "  ||  ".join(rx_list)
    return full_values, total_lat, tx_joined, rx_joined, sub_blocks, active_disabled, block_errors


def write_single_register(port, baud, slave_id, addr, value, parity=None, stopbits=None):
    req = struct.pack('>BBHH', slave_id, 6, addr, value & 0xFFFF)
    pdu, latency, tx_hex, rx_hex = modbus_transceive(port, baud, req, parity=parity, stopbits=stopbits)
    return True, latency, tx_hex, rx_hex


def write_single_coil(port, baud, slave_id, addr, state_val, parity=None, stopbits=None):
    val = 0xFF00 if state_val else 0x0000
    req = struct.pack('>BBHH', slave_id, 5, addr, val)
    pdu, latency, tx_hex, rx_hex = modbus_transceive(port, baud, req, parity=parity, stopbits=stopbits)
    return True, latency, tx_hex, rx_hex


def split_mbap_frames(data: bytes):
    """Tách chính xác các gói Modbus TCP MBAP khi SCADA gửi dồn (pipelining) nhiều gói trên cùng 1 luồng TCP."""
    frames = []
    pos = 0
    n = len(data)
    while pos + 7 <= n:
        if data[pos + 2] != 0 or data[pos + 3] != 0:
            break
        mbap_len = struct.unpack_from('>H', data, pos + 4)[0]
        if mbap_len < 2 or mbap_len > 260:
            break
        end = pos + 6 + mbap_len
        if end > n:
            frames.append(data[pos:])
            pos = n
            break
        frames.append(data[pos:end])
        pos = end
    return frames


# ==================== 1. MULTI-PORT TCP <-> RTU GATEWAY ENGINE ====================
def gateway_instance_worker(gw: GatewayInstance):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind(("0.0.0.0", gw.tcp_port))
        srv.listen(32)
        srv.setblocking(False)
    except Exception as e:
        print(f"[!] Gateway bind failed on TCP {gw.tcp_port} ({gw.serial_port}): {e}")
        gw.running = False
        try:
            srv.close()
        except Exception:
            pass
        return

    gw.running = True
    port_lock = state.get_port_lock(gw.serial_port)
    print(f"[*] Gateway Bridge ACTIVE: TCP 0.0.0.0:{gw.tcp_port} <-> {gw.serial_port} ({gw.baud} 8{gw.parity}{gw.stopbits})")
    clients = []

    while not gw.stop_evt.is_set():
        try:
            r_socks, _, _ = select.select([srv] + clients, [], [], 0.2)
        except Exception:
            time.sleep(0.05)
            continue

        dead_clients = []
        for sock in r_socks:
            if sock is srv:
                try:
                    cl, _ = srv.accept()
                    cl.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                    cl.setblocking(False)
                    clients.append(cl)
                    gw.stats["active_clients"] = len(clients)
                except Exception:
                    pass
                continue

            try:
                data = sock.recv(1024)
                if not data:
                    dead_clients.append(sock)
                    continue

                mbap_frames = split_mbap_frames(data)

                if mbap_frames:
                    for frame in mbap_frames:
                        t0 = time.time()
                        trans_id = frame[0:2]
                        pdu = frame[6:]
                        with port_lock:
                            ser = state.acquire_serial(
                                gw.serial_port, gw.baud, timeout=0.8, parity=gw.parity, stopbits=gw.stopbits
                            )
                            ser.reset_input_buffer()
                            ser.reset_output_buffer()

                            rtu_frame = pdu + calc_crc(pdu)
                            state.log_traffic("TX", to_hex_spaced(rtu_frame), 0, f"GW:{gw.tcp_port}", port=gw.serial_port)
                            ser.write(rtu_frame)
                            ser.flush()

                            rtu_resp = read_rtu_frame(ser)
                            elapsed = int((time.time() - t0) * 1000)

                            if len(rtu_resp) >= 4 and check_crc(rtu_resp):
                                resp_pdu = rtu_resp[:-2]
                                mbap_resp = trans_id + b'\x00\x00' + struct.pack('>H', len(resp_pdu)) + resp_pdu
                                sock.sendall(mbap_resp)
                                gw.stats["packets_bridged"] += 1
                                gw.stats["bytes_tx"] += len(mbap_resp)
                                gw.stats["bytes_rx"] += len(frame)
                                gw.stats["last_latency_ms"] = elapsed
                                state.log_traffic("RX", to_hex_spaced(rtu_resp), elapsed, f"GW:{gw.tcp_port}", port=gw.serial_port)
                            else:
                                gw.stats["errors"] += 1
                else:
                    t0 = time.time()
                    with port_lock:
                        ser = state.acquire_serial(
                            gw.serial_port, gw.baud, timeout=0.8, parity=gw.parity, stopbits=gw.stopbits
                        )
                        ser.reset_input_buffer()
                        ser.reset_output_buffer()
                        state.log_traffic("TX", to_hex_spaced(data), 0, f"RAW:{gw.tcp_port}", port=gw.serial_port)
                        ser.write(data)
                        ser.flush()
                        rtu_resp = read_rtu_frame(ser)
                        elapsed = int((time.time() - t0) * 1000)
                        if rtu_resp:
                            sock.sendall(rtu_resp)
                            gw.stats["packets_bridged"] += 1
                            gw.stats["bytes_tx"] += len(rtu_resp)
                            gw.stats["bytes_rx"] += len(data)
                            gw.stats["last_latency_ms"] = elapsed
                            state.log_traffic("RX", to_hex_spaced(rtu_resp), elapsed, f"RAW:{gw.tcp_port}", port=gw.serial_port)
            except (BlockingIOError, InterruptedError):
                pass
            except (ConnectionResetError, BrokenPipeError, OSError):
                dead_clients.append(sock)
            except Exception:
                gw.stats["errors"] += 1

        for dc in dead_clients:
            if dc in clients:
                clients.remove(dc)
                try:
                    dc.close()
                except Exception:
                    pass
            gw.stats["active_clients"] = len(clients)

    gw.running = False
    gw.stats["active_clients"] = 0
    try:
        srv.close()
    except Exception:
        pass
    for c in clients:
        try:
            c.close()
        except Exception:
            pass
    print(f"[*] Gateway Bridge STOPPED on TCP {gw.tcp_port} ({gw.serial_port}).")


def start_gateway_for_port(serial_port: str, tcp_port: int, baud: int = 9600, parity: str = "N", stopbits: int = 1):
    stop_gateway_for_port(serial_port)
    with state.meta_lock:
        conflict_ports = [p for p, g in state.gateways.items() if g.running and g.tcp_port == int(tcp_port)]
    for cp in conflict_ports:
        stop_gateway_for_port(cp)

    try:
        os.system(f"iptables -C input_rule -p tcp --dport {int(tcp_port)} -j ACCEPT >/dev/null 2>&1 || iptables -I input_rule -p tcp --dport {int(tcp_port)} -j ACCEPT >/dev/null 2>&1")
    except Exception:
        pass

    gw = GatewayInstance(serial_port, tcp_port, baud=baud, parity=parity, stopbits=stopbits)
    gw.running = True
    t = threading.Thread(target=gateway_instance_worker, args=(gw,), daemon=True)
    gw.thread = t
    with state.meta_lock:
        state.gateways[serial_port] = gw
        state.gateway_port = int(tcp_port)
    t.start()
    time.sleep(0.05)
    if state.auto_start_gateways:
        state.save_persistent_config()
    return gw


def stop_gateway_for_port(serial_port: str = None):
    with state.meta_lock:
        if serial_port:
            targets = [state.gateways.get(serial_port)] if serial_port in state.gateways else []
        else:
            targets = list(state.gateways.values())

    for g in targets:
        if g:
            g.stop_evt.set()
    for g in targets:
        if g and g.thread and g.thread.is_alive():
            g.thread.join(timeout=0.8)
        if g:
            g.running = False
            state.close_serial(g.serial_port)
    if state.auto_start_gateways:
        state.save_persistent_config()


# ==================== 2. SMART UNIFIED TCP ROUTER & VIRTUAL ID REMAPPER ====================
def smart_router_worker(sr: SmartRouterInstance):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind(("0.0.0.0", sr.tcp_port))
        srv.listen(32)
        srv.setblocking(False)
    except Exception as e:
        print(f"[!] Smart Router bind failed on TCP {sr.tcp_port}: {e}")
        sr.running = False
        try:
            srv.close()
        except Exception:
            pass
        return

    sr.running = True
    print(f"[*] Smart Unified TCP Hub ACTIVE on 0.0.0.0:{sr.tcp_port} (mode={sr.mode})")
    clients = []
    send_lock = threading.Lock()

    def _dispatch_smart_mbap(client_sock, frame: bytes):
        trans_id = frame[0:2]
        unit_id = frame[6]
        pdu_body = frame[7:]

        target_port = None
        target_baud = 9600
        target_par = "N"
        target_sb = 1
        out_slave_id = unit_id

        if sr.mode == "virtual_id":
            idx = unit_id - sr.base_unit_id
            if 0 <= idx < len(sr.port_configs):
                pcfg = sr.port_configs[idx]
                target_port = pcfg.get("port", f"/dev/ttyCH{idx}")
                target_baud = int(pcfg.get("baud", 9600))
                target_par = pcfg.get("parity", "N")
                target_sb = int(pcfg.get("stopbits", 1))
                out_slave_id = sr.real_slave_id
        else:
            for r in sr.routes:
                if int(r.get("min_id", 1)) <= unit_id <= int(r.get("max_id", 247)):
                    target_port = r.get("port")
                    target_baud = int(r.get("baud", 9600))
                    target_par = r.get("parity", "N")
                    target_sb = int(r.get("stopbits", 1))
                    offset = int(r.get("id_offset", 0))
                    out_slave_id = max(1, min(247, unit_id + offset))
                    break

        if not target_port:
            exc_pdu = bytes([unit_id, (pdu_body[0] | 0x80), 0x0B])
            try:
                with send_lock:
                    client_sock.sendall(trans_id + b'\x00\x00' + struct.pack('>H', len(exc_pdu)) + exc_pdu)
            except Exception:
                pass
            sr.stats["errors"] += 1
            return

        try:
            rtu_req = bytes([out_slave_id]) + pdu_body
            resp_pdu, elapsed, _, _ = modbus_transceive(
                target_port, target_baud, rtu_req, timeout=0.8, parity=target_par, stopbits=target_sb
            )
            remapped_pdu = bytes([unit_id]) + resp_pdu[1:]
            mbap_resp = trans_id + b'\x00\x00' + struct.pack('>H', len(remapped_pdu)) + remapped_pdu
            with send_lock:
                client_sock.sendall(mbap_resp)
            sr.stats["packets_routed"] += 1
            sr.stats["last_latency_ms"] = elapsed
        except Exception:
            sr.stats["errors"] += 1

    while not sr.stop_evt.is_set():
        try:
            r_socks, _, _ = select.select([srv] + clients, [], [], 0.2)
        except Exception:
            time.sleep(0.05)
            continue

        dead_clients = []
        for sock in r_socks:
            if sock is srv:
                try:
                    cl, _ = srv.accept()
                    cl.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                    cl.setblocking(False)
                    clients.append(cl)
                    sr.stats["active_clients"] = len(clients)
                except Exception:
                    pass
                continue

            try:
                data = sock.recv(1024)
                if not data:
                    dead_clients.append(sock)
                    continue
                mbap_frames = split_mbap_frames(data)
                for frm in mbap_frames:
                    if len(frm) >= 8:
                        threading.Thread(target=_dispatch_smart_mbap, args=(sock, frm), daemon=True).start()
            except (BlockingIOError, InterruptedError):
                pass
            except (ConnectionResetError, BrokenPipeError, OSError):
                dead_clients.append(sock)
            except Exception:
                sr.stats["errors"] += 1

        for dc in dead_clients:
            if dc in clients:
                clients.remove(dc)
                try:
                    dc.close()
                except Exception:
                    pass
            sr.stats["active_clients"] = len(clients)

    sr.running = False
    try:
        srv.close()
    except Exception:
        pass
    for c in clients:
        try:
            c.close()
        except Exception:
            pass
    print(f"[*] Smart Unified TCP Hub STOPPED on TCP {sr.tcp_port}.")


def start_smart_router(tcp_port=5000, mode="virtual_id", base_unit_id=1, real_slave_id=1, port_configs=None, routes=None):
    stop_smart_router()
    # Giải phóng cổng TCP nếu đang trùng với Gateway đơn
    with state.meta_lock:
        conflict_ports = [p for p, g in state.gateways.items() if g.running and g.tcp_port == int(tcp_port)]
    for cp in conflict_ports:
        stop_gateway_for_port(cp)

    try:
        os.system(f"iptables -C input_rule -p tcp --dport {int(tcp_port)} -j ACCEPT >/dev/null 2>&1 || iptables -I input_rule -p tcp --dport {int(tcp_port)} -j ACCEPT >/dev/null 2>&1")
    except Exception:
        pass

    sr = SmartRouterInstance(
        tcp_port=tcp_port, mode=mode, base_unit_id=base_unit_id,
        real_slave_id=real_slave_id, port_configs=port_configs, routes=routes
    )
    sr.running = True
    t = threading.Thread(target=smart_router_worker, args=(sr,), daemon=True)
    sr.thread = t
    with state.meta_lock:
        state.smart_router = sr
    t.start()
    time.sleep(0.05)
    return sr


def stop_smart_router():
    with state.meta_lock:
        sr = state.smart_router
        state.smart_router = None
    if sr:
        sr.stop_evt.set()
        if sr.thread and sr.thread.is_alive():
            sr.thread.join(timeout=0.8)
        sr.running = False


# ==================== 3. COM-TO-COM RS485 BAUDRATE / FRAMING BRIDGE ====================
def com_bridge_worker(br: ComBridgeInstance):
    br.running = True
    lock_m = state.get_port_lock(br.master_port)
    lock_s = state.get_port_lock(br.slave_port)
    print(
        f"[*] COM-to-COM Bridge ACTIVE: {br.master_port} ({br.master_baud} 8{br.master_parity}{br.master_stopbits}) "
        f"<-> {br.slave_port} ({br.slave_baud} 8{br.slave_parity}{br.slave_stopbits})"
    )

    while not br.stop_evt.is_set():
        try:
            with lock_m:
                ser_m = state.acquire_serial(
                    br.master_port, br.master_baud, timeout=0.15,
                    parity=br.master_parity, stopbits=br.master_stopbits
                )
                req_frame = read_rtu_master_request(ser_m)

            if not req_frame:
                continue
            if len(req_frame) < 6 or not check_crc(req_frame):
                br.stats["errors"] += 1
                continue

            t0 = time.time()
            state.log_traffic("TX", to_hex_spaced(req_frame), 0, f"C2C->{format_port_short(br.slave_port)}", port=br.master_port)

            with lock_s:
                ser_s = state.acquire_serial(
                    br.slave_port, br.slave_baud, timeout=0.7,
                    parity=br.slave_parity, stopbits=br.slave_stopbits
                )
                ser_s.reset_input_buffer()
                ser_s.write(req_frame)
                ser_s.flush()
                resp_frame = read_rtu_frame(ser_s)

            elapsed = int((time.time() - t0) * 1000)
            if len(resp_frame) >= 4 and check_crc(resp_frame):
                with lock_m:
                    ser_m = state.acquire_serial(
                        br.master_port, br.master_baud, timeout=0.2,
                        parity=br.master_parity, stopbits=br.master_stopbits
                    )
                    ser_m.write(resp_frame)
                    ser_m.flush()
                br.stats["frames_converted"] += 1
                br.stats["last_latency_ms"] = elapsed
                state.log_traffic("RX", to_hex_spaced(resp_frame), elapsed, f"C2C<-{format_port_short(br.slave_port)}", port=br.slave_port)
            else:
                br.stats["errors"] += 1
        except Exception:
            time.sleep(0.05)

    br.running = False
    state.close_serial(br.master_port)
    state.close_serial(br.slave_port)
    print(f"[*] COM-to-COM Bridge STOPPED ({br.master_port} <-> {br.slave_port}).")


def start_com_bridge(master_port, master_baud, master_parity, master_stopbits,
                     slave_port, slave_baud, slave_parity, slave_stopbits):
    if master_port == slave_port:
        raise ValueError("Cổng Master nguồn và Cổng Slave đích phải là 2 cổng COM khác nhau!")
    stop_gateway_for_port(master_port)
    stop_gateway_for_port(slave_port)
    stop_com_bridge(port_filter=master_port)
    stop_com_bridge(port_filter=slave_port)

    br_id = f"{format_port_short(master_port)}_{format_port_short(slave_port)}"
    br = ComBridgeInstance(
        br_id, master_port, master_baud, master_parity, master_stopbits,
        slave_port, slave_baud, slave_parity, slave_stopbits
    )
    br.running = True
    t = threading.Thread(target=com_bridge_worker, args=(br,), daemon=True)
    br.thread = t
    with state.meta_lock:
        state.com_bridges[br_id] = br
    t.start()
    return br


def stop_com_bridge(bridge_id: str = None, port_filter: str = None):
    with state.meta_lock:
        targets = []
        for bid, b in list(state.com_bridges.items()):
            if (bridge_id is None and port_filter is None) or (bid == bridge_id) or (port_filter in (b.master_port, b.slave_port)):
                targets.append(b)
                state.com_bridges.pop(bid, None)
    for b in targets:
        b.stop_evt.set()
    for b in targets:
        if b.thread and b.thread.is_alive():
            b.thread.join(timeout=0.6)
        b.running = False


# ==================== 4. MULTI-PORT CONCURRENT SD DATALOGGER ====================
def flush_datalog_to_sd(csv_path, jsonl_path, db_path, sess_id, sample_idx):
    with state.datalog_buffer_lock:
        if not state.datalog_csv_buffer and not state.datalog_db_buffer and not state.datalog_jsonl_buffer:
            return
        csv_rows = list(state.datalog_csv_buffer)
        jsonl_rows = list(state.datalog_jsonl_buffer)
        db_rows = list(state.datalog_db_buffer)
        state.datalog_csv_buffer.clear()
        state.datalog_jsonl_buffer.clear()
        state.datalog_db_buffer.clear()
        state.datalog_buffered_count = 0
        state.datalog_last_flush = time.time()

    try:
        if csv_rows:
            with open(csv_path, 'a', encoding='utf-8-sig') as f:
                f.write("".join(csv_rows))
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass

        if jsonl_rows:
            with open(jsonl_path, 'a', encoding='utf-8') as f:
                f.write("".join(jsonl_rows))
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass

        if db_rows:
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            cur = conn.cursor()
            cur.executemany(
                "INSERT INTO datalog_points (session_id, timestamp, address, value, raw_hex) VALUES (?, ?, ?, ?, ?)",
                db_rows
            )
            cur.execute("UPDATE datalog_sessions SET sample_count = ? WHERE id = ?", (sample_idx, sess_id))
            conn.commit()
            conn.close()
    except Exception as e:
        print(f"[!] Lỗi ghi batch xuống thẻ nhớ SD: {e}")


def datalogger_worker():
    sess_id = state.current_session_id
    cfg = dict(state.logger_config)
    channels = cfg.get("channels") or []
    if not channels:
        channels = [{
            "label": format_port_short(cfg.get("port") or state.serial_port),
            "port": cfg.get("port") or state.serial_port,
            "baud": int(cfg.get("baud") or state.baudrate),
            "parity": cfg.get("parity") or "N",
            "stopbits": int(cfg.get("stopbits") or 1),
            "slave_id": int(cfg.get("slave_id", 1)),
            "fn_code": int(cfg.get("fn_code", 3)),
            "start_addr": int(cfg.get("start_addr", 0)),
            "count": int(cfg.get("count", 10)),
            "tags": {},
            "scales": {},
            "units": {}
        }]

    sdir = get_storage_dir()
    db_path = os.path.join(sdir, "nxmodbus_datalog.db")
    csv_path = os.path.join(sdir, f"datalog_{sess_id}.csv")
    jsonl_path = os.path.join(sdir, f"ai_telemetry_{sess_id}.jsonl")
    manifest_path = os.path.join(sdir, f"ai_manifest_{sess_id}.json")

    col_headers = []
    for ch_idx, ch in enumerate(channels):
        p_lbl = ch.get("label") or format_port_short(ch.get("port", ""))
        sid = int(ch.get("slave_id", 1))
        s_addr = int(ch.get("start_addr", 0))
        cnt = int(ch.get("count", 1))
        tags_map = ch.get("tags") or {}
        for i in range(cnt):
            reg_no = s_addr + i
            t_name = tags_map.get(str(i)) or tags_map.get(str(reg_no)) or f"Reg{reg_no}"
            safe_t = str(t_name).replace(",", "_").replace(" ", "_")
            col_headers.append(f"{p_lbl}_ID{sid}_{safe_t}")

    with open(csv_path, 'w', encoding='utf-8-sig') as f:
        headers = ["Timestamp_ISO", "Elapsed_Sec", "Delta_Ms", "Avg_Latency_Ms", "Status"] + col_headers
        f.write(",".join(headers) + "\n")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("UPDATE datalog_sessions SET csv_path = ? WHERE id = ?", (csv_path, sess_id))
    conn.commit()
    conn.close()

    sample_idx = 0
    t_start = time.time()
    last_sample_t = t_start
    all_latencies = []
    reg_min = {}
    reg_max = {}

    # Group channels by physical port so distinct COM ports run concurrently in parallel!
    by_port = {}
    for ch_idx, ch in enumerate(channels):
        by_port.setdefault(ch["port"], []).append((ch_idx, ch))

    print(f"[*] Multi-Port Datalogger started ({len(channels)} channels across {len(by_port)} COM ports). Session: {sess_id}")

    with state.datalog_buffer_lock:
        state.datalog_csv_buffer.clear()
        state.datalog_jsonl_buffer.clear()
        state.datalog_db_buffer.clear()
        state.datalog_live_points.clear()
        state.datalog_buffered_count = 0
        state.datalog_last_flush = time.time()

    while not state.logger_stop_evt.is_set():
        t0 = time.time()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        now_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        cur_t = time.time()
        elapsed_sec = int(cur_t - t_start)
        delta_ms = int((cur_t - last_sample_t) * 1000)
        last_sample_t = cur_t

        ch_results = {}
        res_lock = threading.Lock()

        def _poll_port_group(p_items):
            for c_idx, ch_cfg in p_items:
                try:
                    fn = int(ch_cfg.get("fn_code", 3))
                    prt = ch_cfg["port"]
                    bd = int(ch_cfg.get("baud", 9600))
                    par = ch_cfg.get("parity", "N")
                    sb = int(ch_cfg.get("stopbits", 1))
                    sid = int(ch_cfg.get("slave_id", 1))
                    sa = int(ch_cfg.get("start_addr", 0))
                    cnt = int(ch_cfg.get("count", 1))
                    dis_addrs = ch_cfg.get("disabled_addrs")
                    en_addrs = ch_cfg.get("enabled_addrs")
                    only_tag = bool(ch_cfg.get("only_tagged", False))
                    t_map = ch_cfg.get("tags") or {}
                    vals, lat, tx_h, rx_h, s_blks, act_dis, blk_errs = read_registers_smart(
                        prt, bd, sid, fn, sa, cnt,
                        parity=par, stopbits=sb,
                        disabled_addrs=dis_addrs,
                        enabled_addrs=en_addrs,
                        only_tagged=only_tag,
                        tags=t_map
                    )
                    with res_lock:
                        ch_results[c_idx] = {
                            "ok": True, "vals": vals, "lat": lat, "tx": tx_h, "rx": rx_h,
                            "disabled_set": set(act_dis), "block_errors": blk_errs
                        }
                except Exception as ex:
                    with res_lock:
                        ch_results[c_idx] = {
                            "ok": False, "error": str(ex),
                            "vals": [None] * int(ch_cfg.get("count", 1)),
                            "lat": 0, "disabled_set": parse_addr_set(ch_cfg.get("disabled_addrs"))
                        }

        if len(by_port) == 1:
            _poll_port_group(next(iter(by_port.values())))
        else:
            p_threads = [threading.Thread(target=_poll_port_group, args=(items,), daemon=True) for items in by_port.values()]
            for pt in p_threads:
                pt.start()
            for pt in p_threads:
                pt.join()

        any_ok = any(r.get("ok") for r in ch_results.values())
        if any_ok:
            sample_idx += 1
            lats = [r["lat"] for r in ch_results.values() if r.get("ok")]
            avg_lat = int(sum(lats) / len(lats)) if lats else 0
            all_latencies.append(avg_lat)

            flat_csv_vals = []
            jsonl_channels = []
            new_db_rows = []
            new_live_pts = []
            col_cursor = 0

            for c_idx, ch in enumerate(channels):
                res = ch_results.get(c_idx, {"ok": False, "vals": [None] * int(ch.get("count", 1)), "lat": 0, "disabled_set": set()})
                dis_set = res.get("disabled_set") or set()
                scales_map = ch.get("scales") or {}
                units_map = ch.get("units") or {}
                sa = int(ch.get("start_addr", 0))
                pts = []
                for i, raw_v in enumerate(res["vals"]):
                    hdr_key = col_headers[col_cursor] if col_cursor < len(col_headers) else f"Ch{c_idx}_{i}"
                    col_cursor += 1
                    addr = sa + i
                    sc = float(scales_map.get(str(i), scales_map.get(str(addr), 1.0)))
                    un = units_map.get(str(i), units_map.get(str(addr), ""))
                    if raw_v is None:
                        flat_csv_vals.append("")
                        st_lbl = "DISABLED" if addr in dis_set else "TIMEOUT"
                        pts.append({"addr": addr, "val": None, "status": st_lbl})
                    else:
                        scaled_v = round(float(raw_v) * sc, 4) if sc != 1.0 else float(raw_v)
                        flat_csv_vals.append(str(scaled_v))
                        pts.append({"addr": addr, "raw": raw_v, "val": scaled_v, "unit": un, "hex": f"0x{int(raw_v) & 0xFFFF:04X}"})
                        if hdr_key not in reg_min or scaled_v < reg_min[hdr_key]:
                            reg_min[hdr_key] = scaled_v
                        if hdr_key not in reg_max or scaled_v > reg_max[hdr_key]:
                            reg_max[hdr_key] = scaled_v
                        new_db_rows.append((sess_id, now_str, addr, scaled_v, f"0x{int(raw_v) & 0xFFFF:04X}"))
                        new_live_pts.append({"time": now_str[-8:], "addr": addr, "val": scaled_v})

                jsonl_channels.append({
                    "channel": ch.get("label") or format_port_short(ch["port"]),
                    "port": ch["port"],
                    "slave_id": ch.get("slave_id", 1),
                    "fn_code": ch.get("fn_code", 3),
                    "ok": res.get("ok", False),
                    "latency_ms": res.get("lat", 0),
                    "points": pts
                })

            status_tag = "OK" if all(r.get("ok") for r in ch_results.values()) else "PARTIAL"
            csv_line = f"{now_iso},{elapsed_sec},{delta_ms},{avg_lat},{status_tag}," + ",".join(flat_csv_vals) + "\n"
            jsonl_obj = {
                "seq": sample_idx,
                "ts": now_iso,
                "epoch_ms": int(cur_t * 1000),
                "elapsed_sec": elapsed_sec,
                "delta_ms": delta_ms,
                "avg_latency_ms": avg_lat,
                "status": status_tag,
                "channels": jsonl_channels
            }
            jsonl_line = json.dumps(jsonl_obj, separators=(',', ':'), ensure_ascii=False) + "\n"

            with state.datalog_buffer_lock:
                state.datalog_csv_buffer.append(csv_line)
                state.datalog_jsonl_buffer.append(jsonl_line)
                state.datalog_db_buffer.extend(new_db_rows)
                state.datalog_live_points.extend(new_live_pts)
                if len(state.datalog_live_points) > 100:
                    state.datalog_live_points = state.datalog_live_points[-100:]
                state.datalog_buffered_count = len(state.datalog_csv_buffer)

            time_since_flush = time.time() - state.datalog_last_flush
            if len(state.datalog_csv_buffer) >= state.datalog_batch_size or time_since_flush >= state.datalog_max_flush_sec:
                flush_datalog_to_sd(csv_path, jsonl_path, db_path, sess_id, sample_idx)

        spent = time.time() - t0
        rem = cfg['interval_sec'] - spent
        if rem > 0:
            state.logger_stop_evt.wait(rem)

    flush_datalog_to_sd(csv_path, jsonl_path, db_path, sess_id, sample_idx)

    try:
        manifest_data = {
            "schema": "nxmodbus-ai-manifest-v3.2",
            "session_id": sess_id,
            "session_name": cfg["name"],
            "device": "GL.iNet GL-XE300 (Puli 4G LTE IoT Gateway + WCH CH348 8-COM Hub)",
            "os": "OpenWrt 19.07.8 (Linux 4.14.241 MIPS)",
            "started_at": datetime.fromtimestamp(t_start).strftime("%Y-%m-%d %H:%M:%S"),
            "stopped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "duration_sec": int(time.time() - t_start),
            "total_samples": sample_idx,
            "interval_sec": cfg["interval_sec"],
            "batch_flush_size": state.datalog_batch_size,
            "channels": channels,
            "csv_columns": col_headers,
            "metrics": {
                "avg_latency_ms": round(sum(all_latencies) / len(all_latencies), 1) if all_latencies else 0,
                "min_latency_ms": min(all_latencies) if all_latencies else 0,
                "max_latency_ms": max(all_latencies) if all_latencies else 0
            },
            "channel_ranges": {k: {"min": reg_min.get(k, 0), "max": reg_max.get(k, 0)} for k in reg_min},
            "exported_files": {
                "csv_timeseries": os.path.basename(csv_path),
                "ai_telemetry_jsonl": os.path.basename(jsonl_path),
                "sqlite_database": "nxmodbus_datalog.db"
            },
            "ai_prompt_hint": "Tập tin .jsonl chứa dữ liệu đa cổng COM đồng bộ theo thời gian thực (epoch_ms), có thể nạp thẳng vào Python pandas hoặc LLM để phân tích tương quan vận hành và phát hiện bất thường."
        }
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[!] Lỗi ghi AI Manifest: {e}")

    print(f"[*] Multi-Port Datalogger stopped. Files flushed to {csv_path}")


# ==================== 5. AI SPECIFICATION & JSON PROFILE HELPERS ====================
def build_ai_spec_document():
    """Đặc tả JSON chuẩn để các luồng AI Agent khác đọc hiểu và tự động sinh file cấu hình theo dõi."""
    return {
        "schema_id": "nxmodbus-monitor-profile-v3.2",
        "studio_url": f"http://10.212.156.12:{PORT_WEB}",
        "studio_url_wireguard": f"http://10.212.156.12:{PORT_WEB}",
        "studio_url_lan": f"http://192.168.10.1:{PORT_WEB}",
        "description": "Đặc tả cấu hình JSON Theo Dõi Đa Cổng (Multi-Port Modbus Monitoring Profile) dành cho AI Agents & Kỹ sư tự động hóa trên Router GL-XE300 + Bộ 8 Cổng COM WCH CH348L.",
        "hardware_port_mapping": {
            "COM 1": "/dev/ttyCH0 (TCP Gateway mặc định :5001)",
            "COM 2": "/dev/ttyCH1 (TCP Gateway mặc định :5002)",
            "COM 3": "/dev/ttyCH2 (TCP Gateway mặc định :5003)",
            "COM 4": "/dev/ttyCH3 (TCP Gateway mặc định :5004)",
            "COM 5": "/dev/ttyCH4 (TCP Gateway mặc định :5005)",
            "COM 6": "/dev/ttyCH5 (TCP Gateway mặc định :5006)",
            "COM 7": "/dev/ttyCH6 (TCP Gateway mặc định :5007)",
            "COM 8": "/dev/ttyCH7 (TCP Gateway mặc định :5008)",
            "Single_USB_RS485": "/dev/ttyUSB1 (Tự động nhận cáp FTDI, CH340, CP2102, PL2303)",
            "DO_NOT_USE": "/dev/ttyUSB0 (MCU quản lý Pin nội bộ), /dev/ttyUSB2..5 (Modem 4G Quectel)"
        },
        "supported_baudrates": [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 56000, 57600, 115200, 128000, 230400, 256000, 460800, 921600],
        "supported_parity": ["N", "E", "O"],
        "supported_stopbits": [1, 2],
        "supported_fn_codes": {
            "1": "FC01 Read Coils (0x)",
            "2": "FC02 Read Discrete Inputs (1x)",
            "3": "FC03 Read Holding Registers (4x - Mặc định phổ biến nhất)",
            "4": "FC04 Read Input Registers (3x - Cảm biến / Đồng hồ điện)"
        },
        "supported_display_formats": ["uint16", "int16", "hex", "binary", "float_abcd", "float_cdab"],
        "sparse_register_skip_mechanism": {
            "description": "Giải pháp khai báo vùng đọc rộng (count lớn) nhưng CẤM ĐỌC (Disable/Skip) một số thanh ghi ở giữa (tránh lỗi Modbus Exception 0x02 Illegal Data Address trên máy nén Hitachi, máy phát DSE8610, biến tần...): Hệ thống tự động cắt vùng nhớ thành các lệnh đọc con liên tiếp (Contiguous Sub-Blocks) và TUYỆT ĐỐI KHÔNG gửi lệnh chạm vào các thanh ghi bị cấm!",
            "fields": {
                "disabled_addrs": "Danh sách địa chỉ cấm đọc (VD: [3, 4, 5, 8, 9, 10, 12] hoặc chuỗi '3-5, 8-10, 12')",
                "enabled_addrs": "(Tùy chọn) Danh sách địa chỉ cho phép đọc — mọi địa chỉ nằm ngoài danh sách này sẽ tự động bị bỏ qua",
                "only_tagged": "true/false — Nếu bật true, hệ thống CHỈ ĐỌC những thanh ghi có khai báo trong 'tags', tự động bỏ qua mọi thanh ghi trống ở giữa!",
                "hide_disabled": "true/false — Ẩn các dòng bị cấm đọc trên bảng giao diện để bảng gọn gàng"
            }
        },
        "profile_json_structure": {
            "schema": "nxmodbus-monitor-v3.3",
            "profile_name": "Tên dự án / tủ điện theo dõi (Tự động lưu bền vững vào Thẻ nhớ SD)",
            "port_aliases": {"/dev/ttyCH0": "Tủ Tổng MSB", "/dev/ttyCH1": "Cụm Máy Nén Khí Hitachi"},
            "polling_tabs": [
                {
                    "name": "Hitachi HISCREW NEXT II (Gộp Bảng Có Lỗ Cấm Đọc)",
                    "port": "/dev/ttyCH0",
                    "baud": 19200,
                    "parity": "E",
                    "stopbits": 1,
                    "slave_id": 1,
                    "fn_code": 3,
                    "start_addr": 2,
                    "count": 15,
                    "disabled_addrs": [3, 4, 5, 8, 9, 10, 12],
                    "only_tagged": False,
                    "hide_disabled": False,
                    "format": "uint16",
                    "scan_ms": 1000,
                    "auto_poll": False,
                    "tags": {"0": "Áp suất khí xả P1", "4": "Nhiệt độ đầu nén TH1", "5": "Nhiệt độ bình tách TH2", "9": "Nhiệt độ môi trường THX", "11": "Chu kỳ có tải"},
                    "units": {"0": "MPa", "4": "°C", "5": "°C", "9": "°C", "11": "s"},
                    "scales": {"0": 0.01, "4": 1, "5": 1, "9": 1, "11": 1}
                }
            ],
            "datalogger": {
                "auto_start": False,
                "name": "Ghi_Ngam_Da_Cong_24h",
                "interval_sec": 2,
                "batch_size": 30,
                "channels": [
                    {
                        "label": "Hitachi_COM1",
                        "port": "/dev/ttyCH0",
                        "baud": 19200,
                        "parity": "E",
                        "stopbits": 1,
                        "slave_id": 1,
                        "fn_code": 3,
                        "start_addr": 2,
                        "count": 15,
                        "disabled_addrs": [3, 4, 5, 8, 9, 10, 12],
                        "tags": {"0": "P1_MPa", "4": "TH1_C", "5": "TH2_C", "9": "THX_C"},
                        "scales": {"0": 0.01, "4": 1.0, "5": 1.0, "9": 1.0},
                        "units": {"0": "MPa", "4": "C", "5": "C", "9": "C"}
                    }
                ]
            },
            "gateways": {
                "auto_start_on_apply": False,
                "auto_start_on_boot": False,
                "ports": [
                    {"port": "/dev/ttyCH0", "tcp_port": 5001, "baud": 9600, "parity": "N", "stopbits": 1}
                ]
            }
        },
        "rest_endpoints": {
            "GET /api/status": "Trạng thái tổng thể Router, Pin, Nhiệt, 8 cổng CH348, Gateways, Datalogger & Kho JSON Thẻ SD",
            "GET /api/ai/spec": "Đọc đặc tả JSON Schema này để AI tự động sinh file theo dõi",
            "GET /api/profile/list": "Danh sách toàn bộ hồ sơ JSON đang lưu bền vững trong Thẻ nhớ SD (/mnt/sda1/modbus_data/profiles/)",
            "POST /api/profile/load": "Mở và nạp tức thời 1 hồ sơ JSON từ Thẻ nhớ SD theo filename",
            "POST /api/profile/save": "Lưu cấu hình hiện tại vào kho Thẻ nhớ SD",
            "POST /api/profile/delete": "Xóa 1 hồ sơ JSON khỏi Thẻ nhớ SD",
            "GET /api/profile/export": "Xuất cấu hình theo dõi đang chạy thành JSON",
            "POST /api/profile/apply": "Nạp trực tiếp file JSON theo dõi vào hệ thống & tự động lưu bền vững vào Thẻ nhớ SD",
            "POST /api/serial/rescan": "Quét nóng lại các thiết bị USB Serial (hard_reset=true để reset phần cứng USB)",
            "POST /api/poll": "Đọc tức thời thanh ghi (hỗ trợ disabled_addrs / only_tagged tự động cắt khối né thanh ghi cấm đọc)",
            "POST /api/poll/auto_mask": "Tự động thăm dò và phát hiện các thanh ghi cấm đọc (Exception 0x02) trong dải địa chỉ",
            "POST /api/scan": "Quét thiết bị trên 1 cổng hoặc đồng loạt 8 cổng (scan_all_ports=true)"
        },
        "saved_sd_profiles": list_sd_profiles(state.active_profile_name),
        "current_available_ports": discover_serial_ports()
    }


def start_datalogger_from_dict(req: dict):
    if state.logger_running:
        state.logger_stop_evt.set()
        if state.logger_thread:
            state.logger_thread.join(timeout=2.5)
        state.logger_running = False

    channels = req.get("channels") or []
    if channels:
        for ch in channels:
            p = ch.get("port", state.serial_port)
            busy = state.get_port_busy_reason(p)
            if busy:
                raise RuntimeError(busy)
        total_pts = sum(int(c.get("count", 1)) for c in channels)
        log_port = channels[0].get("port", state.serial_port)
        log_baud = int(channels[0].get("baud", 9600))
    else:
        log_port = req.get("port", state.serial_port)
        busy = state.get_port_busy_reason(log_port)
        if busy:
            raise RuntimeError(busy)
        log_baud = int(req.get("baud", state.baudrate))
        total_pts = int(req.get("count", 10))

    name = req.get("name", "Phien_Ghi_Da_Cong")
    interval_sec = max(1, int(req.get("interval_sec", 2)))
    batch_size = max(5, min(int(req.get("batch_size", 30)), 300))
    sess_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    state.current_session_id = sess_id
    state.datalog_batch_size = batch_size
    state.logger_config = {
        "name": name,
        "port": log_port,
        "baud": log_baud,
        "parity": (req.get("parity", "N") or "N").upper(),
        "stopbits": int(req.get("stopbits", 1)),
        "interval_sec": interval_sec,
        "slave_id": int(req.get("slave_id", 1)),
        "start_addr": int(req.get("start_addr", 0)),
        "count": int(req.get("count", 10)),
        "fn_code": int(req.get("fn_code", 3)),
        "batch_size": batch_size,
        "channels": channels
    }

    sdir = get_storage_dir()
    db_path = os.path.join(sdir, "nxmodbus_datalog.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO datalog_sessions (id, name, started_at, interval_sec, is_active, point_count, sample_count)
        VALUES (?, ?, ?, ?, 1, ?, 0)
    """, (sess_id, name, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), interval_sec, total_pts))
    conn.commit()
    conn.close()

    state.logger_stop_evt.clear()
    state.logger_running = True
    state.logger_thread = threading.Thread(target=datalogger_worker, daemon=True)
    state.logger_thread.start()
    return sess_id, sdir


# ==================== HTTP API HANDLER ====================
class StudioHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        query = urllib.parse.parse_qs(u.query)

        # 0. AI Schema, SD Card Profile Library & Profile Export
        if path == "/api/ai/spec":
            self.send_json(build_ai_spec_document())
            return

        if path == "/api/profile/list":
            self.send_json({
                "success": True,
                "active_profile_name": state.active_profile_name,
                "profiles_dir": get_profiles_dir(),
                "profiles": list_sd_profiles(state.active_profile_name)
            })
            return

        if path == "/api/profile/get":
            file_name = query.get("file", [""])[0]
            try:
                pdir = get_profiles_dir()
                clean_name = os.path.basename(str(file_name or "").strip())
                if not clean_name.lower().endswith(".json"):
                    clean_name = sanitize_profile_filename(clean_name)
                prof_data = load_sd_profile_file(clean_name)
                fpath = os.path.join(pdir, clean_name)
                st = os.stat(fpath)
                analysis = analyze_sd_profile_dict(prof_data, clean_name)
                pname = analysis["profile_name"]
                self.send_json({
                    "success": True,
                    "filename": clean_name,
                    "path": fpath,
                    "size_kb": round(st.st_size / 1024.0, 2),
                    "updated_at": prof_data.get("saved_at") or prof_data.get("exported_at") or datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    "is_active": (pname == state.active_profile_name) or (clean_name == sanitize_profile_filename(state.active_profile_name)),
                    "profile": prof_data,
                    "analysis": analysis
                })
            except Exception as e:
                self.send_json({"error": f"Không thể đọc chi tiết hồ sơ '{file_name}': {e}"}, 404)
            return

        if path == "/api/profile/export_all":
            pdir = get_profiles_dir()
            bundle_items = []
            try:
                for fn in sorted(os.listdir(pdir)):
                    if not fn.lower().endswith(".json"):
                        continue
                    fp = os.path.join(pdir, fn)
                    if os.path.isfile(fp):
                        try:
                            with open(fp, "r", encoding="utf-8") as f:
                                bundle_items.append({
                                    "filename": fn,
                                    "profile": json.load(f)
                                })
                        except Exception:
                            pass
            except Exception:
                pass
            bundle_doc = {
                "schema": "nxmodbus-sd-bundle-v3.3",
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "router_host": "GL-XE300",
                "profiles_dir": pdir,
                "active_profile_name": state.active_profile_name,
                "profiles_count": len(bundle_items),
                "profiles": bundle_items
            }
            raw_bytes = json.dumps(bundle_doc, indent=2, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="NXModbus_SD_Profiles_Bundle.json"')
            self.send_header('Content-Length', str(len(raw_bytes)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(raw_bytes)
            return

        if path == "/api/profile/download":
            file_name = query.get("file", [""])[0]
            pdir = get_profiles_dir()
            clean_name = os.path.basename(file_name)
            if not clean_name.lower().endswith(".json"):
                clean_name = sanitize_profile_filename(clean_name)
            target = os.path.join(pdir, clean_name)
            if os.path.exists(target) and os.path.isfile(target):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Disposition', f'attachment; filename="{clean_name}"')
                self.send_header('Content-Length', str(os.path.getsize(target)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(target, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_json({"error": "Không tìm thấy file hồ sơ JSON trên thẻ nhớ SD"}, 404)
            return

        if path == "/api/profile/export":
            self.send_json({
                "schema": "nxmodbus-monitor-v3.3",
                "profile_name": state.active_profile_name or "NXChieu_MultiPort_Profile",
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "port_aliases": state.port_aliases,
                "polling_tabs": state.saved_polling_tabs,
                "datalogger": state.logger_config,
                "gateways": {
                    "auto_start_on_boot": state.auto_start_gateways,
                    "ports": state.get_gateways_list()
                },
                "smart_router": state.get_smart_router_status(),
                "com_bridges": state.get_com_bridges_list()
            })
            return

        # 1. API: System Status
        if path == "/api/status":
            ports = discover_serial_ports()
            ext_ports = [p["id"] for p in ports if p.get("is_external")]
            if ext_ports and (state.serial_port == "/dev/ttyUSB0" or state.serial_port not in [p["id"] for p in ports]):
                state.serial_port = ext_ports[0]

            battery_info = {"percent": None, "charging": False, "temperature": None, "cycles": None}
            if os.path.exists("/usr/bin/xe300-mcu") and state.serial_port != "/dev/ttyUSB0":
                try:
                    if not os.path.exists("/tmp/mcu_data"):
                        os.system("/usr/bin/xe300-mcu >/dev/null 2>&1")
                    elif (time.time() - os.path.getmtime("/tmp/mcu_data")) > 25:
                        os.system("/usr/bin/xe300-mcu >/dev/null 2>&1 &")
                except Exception:
                    pass

            if os.path.exists("/tmp/mcu_data"):
                try:
                    with open("/tmp/mcu_data", "rb") as f:
                        raw_mcu = f.read().decode("utf-8", errors="ignore").replace("\x00", "").strip()
                        mcu_data = json.loads(raw_mcu)
                        if "P" in mcu_data:
                            battery_info["percent"] = mcu_data["P"]
                        elif "percent" in mcu_data:
                            battery_info["percent"] = mcu_data["percent"]
                        if "T" in mcu_data:
                            battery_info["temperature"] = mcu_data["T"]
                        elif "temperature" in mcu_data:
                            battery_info["temperature"] = mcu_data["temperature"]
                        if "C" in mcu_data:
                            battery_info["charging"] = bool(mcu_data["C"])
                        elif "charging" in mcu_data:
                            battery_info["charging"] = bool(mcu_data["charging"])
                        if "N" in mcu_data:
                            battery_info["cycles"] = mcu_data["N"]
                except Exception:
                    pass

            temperature_c = battery_info.get("temperature")
            if temperature_c is None:
                for tz in ["/sys/class/thermal/thermal_zone0/temp", "/sys/class/hwmon/hwmon0/temp1_input"]:
                    if os.path.exists(tz):
                        try:
                            with open(tz) as tf:
                                tval = int(tf.read().strip())
                                temperature_c = round(tval / 1000.0, 1) if tval > 1000 else float(tval)
                                battery_info["temperature"] = temperature_c
                                break
                        except Exception:
                            pass

            uptime_str = "--"
            if os.path.exists("/proc/uptime"):
                try:
                    with open("/proc/uptime") as uf:
                        up_sec = int(float(uf.read().split()[0]))
                        hrs, rem = divmod(up_sec, 3600)
                        mins, _ = divmod(rem, 60)
                        uptime_str = f"{hrs}h {mins}m"
                except Exception:
                    pass

            sd_mounted = os.path.ismount("/mnt/sda1")
            st = os.statvfs("/mnt/sda1") if sd_mounted else os.statvfs("/")
            free_gb = (st.f_bavail * st.f_frsize) / (1024**3)
            total_gb = (st.f_blocks * st.f_frsize) / (1024**3)

            flash_free_mb = 0
            flash_total_mb = 0
            flash_used_mb = 0
            try:
                st_fl = os.statvfs("/overlay") if os.path.exists("/overlay") else os.statvfs("/")
                flash_free_mb = round((st_fl.f_bavail * st_fl.f_frsize) / (1024**2), 1)
                flash_total_mb = round((st_fl.f_blocks * st_fl.f_frsize) / (1024**2), 1)
                flash_used_mb = round(max(0.0, flash_total_mb - flash_free_mb), 1)
            except Exception:
                pass

            mem_free_mb = 0
            mem_total_mb = 124
            mem_avail_mb = 0
            if os.path.exists("/proc/meminfo"):
                with open("/proc/meminfo") as f:
                    for line in f:
                        if "MemTotal" in line:
                            mem_total_mb = int(line.split()[1]) // 1024
                        elif "MemAvailable" in line:
                            mem_avail_mb = int(line.split()[1]) // 1024
                        elif "MemFree" in line and mem_avail_mb == 0:
                            mem_free_mb = int(line.split()[1]) // 1024
            if mem_avail_mb > 0:
                mem_free_mb = mem_avail_mb

            parity_val = getattr(state, "parity", "N")
            stopbits_val = getattr(state, "stopbits", 1)
            ch348_info = ch348_hub.get_status_dict() if ch348_hub is not None else {"online": False, "port_count": 0, "ports": []}
            active_gws = state.get_gateways_list()
            sr_status = state.get_smart_router_status()

            self.send_json({
                "status": "online",
                "version": "3.3",
                "serial_port": state.serial_port,
                "baudrate": state.baudrate,
                "parity": parity_val,
                "stopbits": stopbits_val,
                "framing": f"{state.baudrate} 8{parity_val}{stopbits_val}",
                "available_ports": ports,
                "port_aliases": state.port_aliases,
                "saved_polling_tabs": state.saved_polling_tabs,
                "active_profile_name": state.active_profile_name,
                "saved_profiles": list_sd_profiles(state.active_profile_name),
                "ch348": ch348_info,
                "network_interfaces": get_network_interfaces(),
                "battery": battery_info,
                "temperature_c": temperature_c,
                "uptime": uptime_str,
                "gateway_running": state.gateway_running,
                "gateway_port": sr_status["tcp_port"] if sr_status.get("running") else (active_gws[0]["tcp_port"] if active_gws else state.gateway_port),
                "gateway_stats": state.gateway_stats,
                "gateways": active_gws,
                "auto_start_gateways": state.auto_start_gateways,
                "smart_router": sr_status,
                "com_bridges": state.get_com_bridges_list(),
                "logger_running": state.logger_running,
                "logger_session": state.current_session_id,
                "logger_channels_count": len(state.logger_config.get("channels") or []) or 1,
                "datalog_buffered": state.datalog_buffered_count,
                "datalog_batch_size": state.datalog_batch_size,
                "sd_card": {
                    "mounted": sd_mounted,
                    "path": "/mnt/sda1" if sd_mounted else "/tmp",
                    "free_gb": round(free_gb, 2),
                    "total_gb": round(total_gb, 2)
                },
                "flash": {
                    "path": "/overlay",
                    "free_mb": flash_free_mb,
                    "used_mb": flash_used_mb,
                    "total_mb": flash_total_mb
                },
                "mem": {
                    "free_mb": mem_free_mb,
                    "used_mb": max(0, mem_total_mb - mem_free_mb),
                    "total_mb": mem_total_mb
                },
                "mem_free_mb": mem_free_mb,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            return

        if path == "/api/network/interfaces":
            self.send_json(get_network_interfaces())
            return

        if path == "/api/datalog/sessions":
            sdir = get_storage_dir()
            db_path = os.path.join(sdir, "nxmodbus_datalog.db")
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("SELECT id, name, started_at, stopped_at, interval_sec, is_active, sample_count, csv_path FROM datalog_sessions ORDER BY started_at DESC LIMIT 50")
            rows = cur.fetchall()
            conn.close()

            res = []
            for r in rows:
                csv_exists = os.path.exists(r[7]) if r[7] else False
                csv_size = os.path.getsize(r[7]) if csv_exists else 0
                sess_id = r[0]
                jsonl_path = os.path.join(sdir, f"ai_telemetry_{sess_id}.jsonl")
                jsonl_exists = os.path.exists(jsonl_path)
                jsonl_size = os.path.getsize(jsonl_path) if jsonl_exists else 0
                manifest_path = os.path.join(sdir, f"ai_manifest_{sess_id}.json")
                manifest_exists = os.path.exists(manifest_path)
                manifest_size = os.path.getsize(manifest_path) if manifest_exists else 0
                res.append({
                    "id": r[0], "name": r[1], "started_at": r[2], "stopped_at": r[3],
                    "interval_sec": r[4], "is_active": bool(r[5]), "sample_count": r[6],
                    "csv_path": r[7], "csv_size": csv_size,
                    "csv_name": os.path.basename(r[7]) if r[7] else f"datalog_{sess_id}.csv",
                    "jsonl_name": f"ai_telemetry_{sess_id}.jsonl",
                    "jsonl_exists": jsonl_exists,
                    "jsonl_size": jsonl_size,
                    "manifest_name": f"ai_manifest_{sess_id}.json",
                    "manifest_exists": manifest_exists,
                    "manifest_size": manifest_size
                })
            self.send_json(res)
            return

        if path == "/api/datalog/download":
            file_name = query.get("file", [""])[0]
            sdir = get_storage_dir()
            clean_name = os.path.basename(file_name)
            target = os.path.join(sdir, clean_name)
            if os.path.exists(target) and os.path.isfile(target):
                content_type = 'application/octet-stream'
                if clean_name.endswith('.csv'):
                    content_type = 'text/csv; charset=utf-8'
                elif clean_name.endswith('.jsonl'):
                    content_type = 'application/x-ndjson; charset=utf-8'
                elif clean_name.endswith('.json'):
                    content_type = 'application/json; charset=utf-8'
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Disposition', f'attachment; filename="{clean_name}"')
                self.send_header('Content-Length', str(os.path.getsize(target)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(target, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_json({"error": "File not found"}, 404)
            return

        if path == "/api/datalog/records":
            with state.datalog_buffer_lock:
                live_pts = list(state.datalog_live_points)
            sdir = get_storage_dir()
            db_path = os.path.join(sdir, "nxmodbus_datalog.db")
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("SELECT timestamp, address, value FROM datalog_points ORDER BY id DESC LIMIT 100")
            rows = cur.fetchall()
            conn.close()
            rows.reverse()
            db_pts = [{"time": r[0][-8:], "addr": r[1], "val": r[2]} for r in rows]
            seen = set((p["time"], p["addr"]) for p in db_pts)
            for lp in live_pts:
                key = (lp["time"], lp["addr"])
                if key not in seen:
                    db_pts.append(lp)
                    seen.add(key)
            self.send_json(db_pts[-100:])
            return

        if path == "/api/traffic":
            limit = int(query.get("limit", [80])[0])
            with state.traffic_lock:
                items = list(state.traffic_log[-limit:])
            self.send_json(items)
            return

        if path == "/api/traffic/clear":
            with state.traffic_lock:
                state.traffic_log.clear()
            self.send_json({"success": True})
            return

        if path in ("/", "/index.html", "/modbus"):
            html_file = os.path.join(BASE_APP_DIR, "web", "index.html")
            if os.path.exists(html_file):
                with open(html_file, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        if path.startswith(("/css/", "/js/", "/assets/")):
            rel = path.lstrip("/").replace("..", "")
            asset_file = os.path.join(BASE_APP_DIR, "web", *rel.split("/"))
            if os.path.isfile(asset_file):
                with open(asset_file, 'rb') as f:
                    content = f.read()
                ctype = 'application/octet-stream'
                if asset_file.endswith('.css'):
                    ctype = 'text/css; charset=utf-8'
                elif asset_file.endswith('.js'):
                    ctype = 'application/javascript; charset=utf-8'
                elif asset_file.endswith('.svg'):
                    ctype = 'image/svg+xml'
                elif asset_file.endswith('.json'):
                    ctype = 'application/json; charset=utf-8'
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        self.send_json({"error": "Not Found"}, 404)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(length) if length > 0 else b'{}'
        try:
            req = json.loads(post_data.decode('utf-8'))
        except Exception as e:
            self.send_json({"error": f"JSON không hợp lệ: {e}"}, 400)
            return

        # 0a. API: Instant USB Rescan / Hardware Reset (Nút Quét Lại USB)
        if path == "/api/serial/rescan":
            hard_reset = bool(req.get("hard_reset", False))
            state.cleanup_unplugged_serials()
            ch_status = {"online": False, "port_count": 0}
            if ch348_hub is not None:
                ch_status = ch348_hub.force_rescan(reset_usb=hard_reset)
            ports = discover_serial_ports()
            ext_ports = [p for p in ports if p.get("is_external")]
            if ext_ports and (state.serial_port == "/dev/ttyUSB0" or state.serial_port not in [p["id"] for p in ports]):
                state.serial_port = ext_ports[0]["id"]
            self.send_json({
                "success": True,
                "hard_reset": hard_reset,
                "external_count": len(ext_ports),
                "available_ports": ports,
                "ch348": ch_status,
                "serial_port": state.serial_port,
                "message": f"Đã quét lại USB thành công: {len(ext_ports)} cổng RS485/COM sẵn sàng!"
            })
            return

        # 0b. API: Đặt Bí Danh Cổng COM (Port Alias)
        if path == "/api/ports/alias":
            if isinstance(req.get("aliases"), dict):
                for k, v in req["aliases"].items():
                    if v and str(v).strip():
                        state.port_aliases[k] = str(v).strip()
                    else:
                        state.port_aliases.pop(k, None)
            elif req.get("port"):
                p = req["port"]
                al = str(req.get("alias", "")).strip()
                if al:
                    state.port_aliases[p] = al
                else:
                    state.port_aliases.pop(p, None)
            state.save_persistent_config()
            self.send_json({
                "success": True,
                "port_aliases": state.port_aliases,
                "available_ports": discover_serial_ports()
            })
            return

        # 0c. API: Nạp / Lưu / Mở / Xóa Cấu Hình JSON Theo Dõi Bền Vững Trong Thẻ Nhớ SD
        if path in ("/api/profile/apply", "/api/profile/save"):
            try:
                prof_name = str(req.get("profile_name", state.active_profile_name or "AI_Monitoring_Profile")).strip()
                if not prof_name:
                    prof_name = "AI_Monitoring_Profile"
                state.active_profile_name = prof_name

                if isinstance(req.get("port_aliases"), dict):
                    for k, v in req["port_aliases"].items():
                        if v and str(v).strip():
                            state.port_aliases[k] = str(v).strip()

                applied_tabs = []
                if isinstance(req.get("polling_tabs"), list) and len(req["polling_tabs"]) > 0:
                    for idx, t in enumerate(req["polling_tabs"]):
                        prt = t.get("port", state.serial_port)
                        bd = int(t.get("baud", 9600))
                        par = (t.get("parity", "N") or "N").upper()
                        sb = int(t.get("stopbits", 1))
                        if prt.startswith("/dev/ttyCH") and ch348_hub is not None and ch348_hub.online:
                            try:
                                ch348_hub.configure_port(int(prt.replace("/dev/ttyCH", "")), bd, par, sb)
                            except Exception:
                                pass
                        dis_list = sorted(parse_addr_set(t.get("disabled_addrs") or t.get("skip_addrs")))
                        en_list = sorted(parse_addr_set(t.get("enabled_addrs")))
                        ro_list = sorted(parse_addr_set(t.get("read_only_addrs")))
                        applied_tabs.append({
                            "id": t.get("id") or f"tab_ai_{idx + 1}",
                            "name": t.get("name") or f"Kênh AI {idx + 1}",
                            "port": prt,
                            "baud": bd,
                            "parity": par,
                            "stopbits": sb,
                            "slave_id": int(t.get("slave_id", 1)),
                            "fn_code": int(t.get("fn_code", 3)),
                            "start_addr": int(t.get("start_addr", 0)),
                            "count": max(1, min(int(t.get("count", 10)), 250)),
                            "disabled_addrs": dis_list,
                            "enabled_addrs": en_list,
                            "read_only_addrs": ro_list,
                            "only_tagged": bool(t.get("only_tagged", False)),
                            "hide_disabled": bool(t.get("hide_disabled", False)),
                            "format": t.get("format", "uint16"),
                            "scan_ms": max(200, int(t.get("scan_ms", 1000))),
                            "auto_poll": bool(t.get("auto_poll", False)),
                            "tags": t.get("tags") or {},
                            "units": t.get("units") or {},
                            "scales": t.get("scales") or {},
                            "controls": t.get("controls") or {}
                        })
                    state.saved_polling_tabs = applied_tabs

                gw_cfg = req.get("gateways")
                started_gws = 0
                if isinstance(gw_cfg, dict):
                    if "auto_start_on_boot" in gw_cfg:
                        state.auto_start_gateways = bool(gw_cfg["auto_start_on_boot"])
                    if gw_cfg.get("auto_start_on_apply") and isinstance(gw_cfg.get("ports"), list):
                        for gp in gw_cfg["ports"]:
                            gw = start_gateway_for_port(
                                gp["port"], int(gp.get("tcp_port", 5001)),
                                baud=int(gp.get("baud", 9600)),
                                parity=gp.get("parity", "N"),
                                stopbits=int(gp.get("stopbits", 1))
                            )
                            if gw.running:
                                started_gws += 1

                dl_cfg = req.get("datalogger")
                started_sess = None
                if isinstance(dl_cfg, dict):
                    if dl_cfg.get("channels"):
                        state.logger_config["channels"] = dl_cfg["channels"]
                    if dl_cfg.get("auto_start"):
                        started_sess, _ = start_datalogger_from_dict(dl_cfg)

                saved_meta = save_sd_profile_file({
                    "profile_name": prof_name,
                    "base_profile": str(req.get("base_profile") or prof_name.split("__v")[0]),
                    "version_num": int(req.get("version_num", 1)) if str(req.get("version_num", "")).isdigit() else 1,
                    "version_note": str(req.get("version_note") or ""),
                    "port_aliases": state.port_aliases,
                    "polling_tabs": state.saved_polling_tabs,
                    "trend_watches": req.get("trend_watches") or [],
                    "datalogger": dl_cfg or state.logger_config,
                    "gateways": gw_cfg or {"auto_start_on_boot": state.auto_start_gateways, "ports": state.saved_gateways}
                }, custom_filename=req.get("filename"))

                state.save_persistent_config(also_save_sd_profile=False)
                self.send_json({
                    "success": True,
                    "profile_name": prof_name,
                    "saved_file": saved_meta["filename"],
                    "saved_path": saved_meta["path"],
                    "tabs_count": len(state.saved_polling_tabs),
                    "polling_tabs": state.saved_polling_tabs,
                    "port_aliases": state.port_aliases,
                    "saved_profiles": list_sd_profiles(state.active_profile_name),
                    "available_ports": discover_serial_ports(),
                    "started_gateways": started_gws,
                    "started_datalog_session": started_sess,
                    "message": f"Đã nạp & lưu bền vững '{prof_name}' ({len(state.saved_polling_tabs)} Tab) vào Thẻ nhớ SD ({saved_meta['filename']})!"
                })
            except Exception as e:
                self.send_json({"error": f"Lỗi khi nạp/lưu JSON Profile: {e}"}, 400)
            return

        if path == "/api/profile/load":
            try:
                fname = req.get("filename") or req.get("profile_name")
                if not fname:
                    self.send_json({"error": "Thiếu tên file hồ sơ (filename) cần mở từ thẻ nhớ SD."}, 400)
                    return
                prof_data = load_sd_profile_file(fname)
                prof_name = str(prof_data.get("profile_name") or fname).strip()
                if prof_name.lower().endswith(".json"):
                    prof_name = prof_name[:-5]
                state.active_profile_name = prof_name

                if isinstance(prof_data.get("port_aliases"), dict):
                    for k, v in prof_data["port_aliases"].items():
                        if v and str(v).strip():
                            state.port_aliases[k] = str(v).strip()

                loaded_tabs = []
                for idx, t in enumerate(prof_data.get("polling_tabs") or []):
                    prt = t.get("port", state.serial_port)
                    bd = int(t.get("baud", 9600))
                    par = (t.get("parity", "N") or "N").upper()
                    sb = int(t.get("stopbits", 1))
                    if prt.startswith("/dev/ttyCH") and ch348_hub is not None and ch348_hub.online:
                        try:
                            ch348_hub.configure_port(int(prt.replace("/dev/ttyCH", "")), bd, par, sb)
                        except Exception:
                            pass
                    dis_list = sorted(parse_addr_set(t.get("disabled_addrs") or t.get("skip_addrs")))
                    en_list = sorted(parse_addr_set(t.get("enabled_addrs")))
                    ro_list = sorted(parse_addr_set(t.get("read_only_addrs")))
                    loaded_tabs.append({
                        "id": t.get("id") or f"tab_sd_{idx + 1}",
                        "name": t.get("name") or f"Kênh {idx + 1}",
                        "port": prt,
                        "baud": bd,
                        "parity": par,
                        "stopbits": sb,
                        "slave_id": int(t.get("slave_id", 1)),
                        "fn_code": int(t.get("fn_code", 3)),
                        "start_addr": int(t.get("start_addr", 0)),
                        "count": max(1, min(int(t.get("count", 10)), 250)),
                        "disabled_addrs": dis_list,
                        "enabled_addrs": en_list,
                        "read_only_addrs": ro_list,
                        "only_tagged": bool(t.get("only_tagged", False)),
                        "hide_disabled": bool(t.get("hide_disabled", False)),
                        "format": t.get("format", "uint16"),
                        "scan_ms": max(200, int(t.get("scan_ms", 1000))),
                        "auto_poll": bool(t.get("auto_poll", False)),
                        "tags": t.get("tags") or {},
                        "units": t.get("units") or {},
                        "scales": t.get("scales") or {},
                        "controls": t.get("controls") or {}
                    })
                if loaded_tabs:
                    state.saved_polling_tabs = loaded_tabs

                state.save_persistent_config(also_save_sd_profile=False)
                self.send_json({
                    "success": True,
                    "profile_name": prof_name,
                    "tabs_count": len(loaded_tabs),
                    "polling_tabs": loaded_tabs,
                    "trend_watches": prof_data.get("trend_watches") or [],
                    "port_aliases": state.port_aliases,
                    "datalogger": prof_data.get("datalogger") or state.logger_config,
                    "saved_profiles": list_sd_profiles(state.active_profile_name),
                    "available_ports": discover_serial_ports(),
                    "message": f"Đã mở nhanh hồ sơ '{prof_name}' ({len(loaded_tabs)} Tab) từ Thẻ nhớ SD!"
                })
            except Exception as e:
                self.send_json({"error": f"Không thể mở hồ sơ từ thẻ nhớ SD: {e}"}, 404)
            return

        if path == "/api/profile/delete":
            fname = req.get("filename")
            ok = delete_sd_profile_file(fname)
            self.send_json({
                "success": ok,
                "saved_profiles": list_sd_profiles(state.active_profile_name),
                "message": f"Đã xóa hồ sơ '{fname}' khỏi Thẻ nhớ SD." if ok else "Không tìm thấy file để xóa."
            })
            return

        if path in ("/api/profile/import", "/api/profile/store"):
            try:
                saved_items = []
                # Hỗ trợ nạp gói Bundle nhiều hồ sơ hoặc 1 hồ sơ đơn lẻ mà không ghi đè phiên đang chạy
                if isinstance(req.get("profiles"), list):
                    for item in req["profiles"]:
                        if isinstance(item, dict) and isinstance(item.get("profile"), dict):
                            meta = save_sd_profile_file(item["profile"], custom_filename=item.get("filename"))
                            saved_items.append(meta)
                        elif isinstance(item, dict) and "polling_tabs" in item:
                            meta = save_sd_profile_file(item, custom_filename=item.get("filename"))
                            saved_items.append(meta)
                elif isinstance(req.get("profile"), dict):
                    meta = save_sd_profile_file(req["profile"], custom_filename=req.get("filename"))
                    saved_items.append(meta)
                elif isinstance(req, dict) and ("polling_tabs" in req or "profile_name" in req):
                    meta = save_sd_profile_file(req, custom_filename=req.get("filename"))
                    saved_items.append(meta)
                else:
                    self.send_json({"error": "Định dạng JSON nạp vào không hợp lệ (thiếu polling_tabs hoặc profiles)."}, 400)
                    return

                self.send_json({
                    "success": True,
                    "imported_count": len(saved_items),
                    "imported_items": saved_items,
                    "saved_profiles": list_sd_profiles(state.active_profile_name),
                    "message": f"Đã lưu bền vững {len(saved_items)} hồ sơ vào Thẻ nhớ SD ({get_profiles_dir()})!"
                })
            except Exception as e:
                self.send_json({"error": f"Lỗi khi lưu hồ sơ vào Thẻ nhớ SD: {e}"}, 400)
            return

        if path == "/api/profile/clone":
            try:
                src_file = req.get("filename")
                if not src_file:
                    self.send_json({"error": "Thiếu filename cần nhân bản."}, 400)
                    return
                src_data = load_sd_profile_file(src_file)
                new_name = str(req.get("new_profile_name") or f"{src_data.get('profile_name', 'Profile')}_Copy").strip()
                src_data["profile_name"] = new_name
                meta = save_sd_profile_file(src_data, custom_filename=req.get("new_filename") or new_name)
                self.send_json({
                    "success": True,
                    "cloned_file": meta["filename"],
                    "profile_name": meta["profile_name"],
                    "saved_profiles": list_sd_profiles(state.active_profile_name),
                    "message": f"Đã nhân bản thành công hồ sơ '{new_name}' ({meta['filename']})!"
                })
            except Exception as e:
                self.send_json({"error": f"Không thể nhân bản hồ sơ: {e}"}, 400)
            return

        if path == "/api/profile/rename":
            try:
                old_file = req.get("filename")
                new_name = str(req.get("new_profile_name") or "").strip()
                if not old_file or not new_name:
                    self.send_json({"error": "Thiếu filename hoặc new_profile_name."}, 400)
                    return
                prof_data = load_sd_profile_file(old_file)
                old_pname = str(prof_data.get("profile_name") or "")
                prof_data["profile_name"] = new_name
                new_fname = sanitize_profile_filename(req.get("new_filename") or new_name)
                meta = save_sd_profile_file(prof_data, custom_filename=new_fname)
                if os.path.basename(old_file) != meta["filename"]:
                    delete_sd_profile_file(old_file)
                if state.active_profile_name in (old_pname, os.path.basename(old_file)[:-5]):
                    state.active_profile_name = new_name
                    state.save_persistent_config(also_save_sd_profile=False)
                self.send_json({
                    "success": True,
                    "new_filename": meta["filename"],
                    "profile_name": new_name,
                    "saved_profiles": list_sd_profiles(state.active_profile_name),
                    "message": f"Đã đổi tên hồ sơ thành '{new_name}' ({meta['filename']})!"
                })
            except Exception as e:
                self.send_json({"error": f"Không thể đổi tên hồ sơ: {e}"}, 400)
            return

        # 0d. API: Thay đổi cấu hình Serial Port mặc định
        if path == "/api/serial/config":
            port = req.get("port", state.serial_port)
            baud = int(req.get("baud", state.baudrate))
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))
            if "alias" in req:
                al = str(req.get("alias") or "").strip()
                if al:
                    state.port_aliases[port] = al
                else:
                    state.port_aliases.pop(port, None)
                state.save_persistent_config()

            port_lock = state.get_port_lock(port)
            with port_lock:
                state.serial_port = port
                state.baudrate = baud
                state.parity = parity
                state.stopbits = stopbits
                if port.startswith("/dev/ttyCH") and ch348_hub is not None and ch348_hub.online:
                    try:
                        p_idx = int(port.replace("/dev/ttyCH", ""))
                        ch348_hub.configure_port(p_idx, baud, parity, stopbits)
                    except Exception:
                        pass
                else:
                    state.close_serial(port)

            self.send_json({
                "success": True,
                "serial_port": port,
                "baudrate": baud,
                "parity": parity,
                "stopbits": stopbits,
                "framing": f"{baud} 8{parity}{stopbits}",
                "port_aliases": state.port_aliases,
                "available_ports": discover_serial_ports()
            })
            return

        # 1. API: Multi-Port Concurrent Modbus Poll (Smart Sub-Block Splitting for Disabled Registers, RTU + TCP)
        if path == "/api/poll":
            port = resolve_req_endpoint(req, state.serial_port)
            busy = state.get_port_busy_reason(port)
            if busy:
                self.send_json({"error": busy}, 409)
                return

            baud = int(req.get("baud", state.baudrate))
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))
            slave_id = int(req.get("slave_id", 1))
            fn_code = int(req.get("fn_code", 3))
            start_addr = int(req.get("start_addr", 0))
            count = max(1, min(int(req.get("count", 10)), 250))
            disabled_addrs = req.get("disabled_addrs")
            enabled_addrs = req.get("enabled_addrs")
            only_tagged = bool(req.get("only_tagged", False))
            tags = req.get("tags") if isinstance(req.get("tags"), dict) else None

            try:
                if fn_code in (1, 2, 3, 4):
                    vals, lat, tx_hex, rx_hex, sub_blocks, active_disabled, block_errors = read_registers_smart(
                        port, baud, slave_id, fn_code, start_addr, count,
                        parity=parity, stopbits=stopbits,
                        disabled_addrs=disabled_addrs,
                        enabled_addrs=enabled_addrs,
                        only_tagged=only_tagged,
                        tags=tags
                    )
                    self.send_json({
                        "success": True,
                        "port": port,
                        "port_label": format_port_short(port),
                        "values": vals,
                        "latency_ms": lat,
                        "tx_hex": tx_hex,
                        "rx_hex": rx_hex,
                        "sub_blocks_count": len(sub_blocks),
                        "sub_blocks": sub_blocks,
                        "disabled_addrs": active_disabled,
                        "block_errors": block_errors
                    })
                else:
                    self.send_json({"error": "Function code không hỗ trợ"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        # 1b. API: Auto-Mask Forbidden Registers (Tự động dò & khóa các thanh ghi cấm đọc ở giữa gây lỗi Exception 0x02)
        if path == "/api/poll/auto_mask":
            port = resolve_req_endpoint(req, state.serial_port)
            busy = state.get_port_busy_reason(port)
            if busy:
                self.send_json({"error": busy}, 409)
                return

            baud = int(req.get("baud", state.baudrate))
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))
            slave_id = int(req.get("slave_id", 1))
            fn_code = int(req.get("fn_code", 3))
            start_addr = max(0, int(req.get("start_addr", 0)))
            count = max(1, min(int(req.get("count", 10)), 250))
            timeout_sec = max(0.06, min(float(req.get("timeout_ms", 180)) / 1000.0, 1.0))

            disabled_found = []
            valid_values = [None] * count
            total_lat = 0
            any_reply = False

            cur_idx = 0
            chunk_sz = 8
            while cur_idx < count:
                c_len = min(chunk_sz, count - cur_idx)
                c_addr = start_addr + cur_idx
                chunk_ok = False
                try:
                    req_pdu = struct.pack('>BBHH', slave_id, fn_code, c_addr, c_len)
                    pdu, lat, _, _ = modbus_transceive(port, baud, req_pdu, timeout=timeout_sec, parity=parity, stopbits=stopbits)
                    any_reply = True
                    total_lat += lat
                    if pdu[1] < 0x80:
                        chunk_ok = True
                        if fn_code in (3, 4):
                            for j in range(c_len):
                                b_pos = 3 + j * 2
                                if b_pos + 2 <= len(pdu):
                                    valid_values[cur_idx + j] = struct.unpack_from('>H', pdu, b_pos)[0]
                        else:
                            for j in range(c_len):
                                byte_idx = 3 + (j // 8)
                                bit_idx = j % 8
                                valid_values[cur_idx + j] = ((pdu[byte_idx] >> bit_idx) & 1) if byte_idx < len(pdu) else 0
                except TimeoutError:
                    if not any_reply and cur_idx == 0:
                        self.send_json({"error": f"[{format_port_short(port)}] Thiết bị Slave {slave_id} không phản hồi (Timeout). Hãy kiểm tra kết nối RS485/TCP hoặc tốc độ Baud."}, 504)
                        return
                except Exception:
                    pass

                if not chunk_ok:
                    # Dò từng thanh ghi trong cụm bị lỗi để tìm chính xác địa chỉ cấm đọc (Exception 0x02)
                    for j in range(c_len):
                        s_addr = c_addr + j
                        try:
                            req_pdu = struct.pack('>BBHH', slave_id, fn_code, s_addr, 1)
                            pdu, lat, _, _ = modbus_transceive(port, baud, req_pdu, timeout=timeout_sec, parity=parity, stopbits=stopbits)
                            any_reply = True
                            total_lat += lat
                            if pdu[1] < 0x80:
                                if fn_code in (3, 4) and len(pdu) >= 5:
                                    valid_values[cur_idx + j] = struct.unpack_from('>H', pdu, 3)[0]
                                elif fn_code in (1, 2) and len(pdu) >= 4:
                                    valid_values[cur_idx + j] = pdu[3] & 1
                            else:
                                disabled_found.append(s_addr)
                        except Exception:
                            disabled_found.append(s_addr)
                cur_idx += c_len

            sub_blocks, _ = build_safe_sub_blocks(start_addr, count, disabled_addrs=disabled_found)
            self.send_json({
                "success": True,
                "port": port,
                "slave_id": slave_id,
                "start_addr": start_addr,
                "count": count,
                "disabled_addrs": sorted(set(disabled_found)),
                "disabled_ranges": format_addr_ranges(disabled_found),
                "disabled_count": len(set(disabled_found)),
                "valid_count": count - len(set(disabled_found)),
                "sub_blocks_count": len(sub_blocks),
                "sub_blocks": sub_blocks,
                "values": valid_values,
                "latency_ms": total_lat,
                "message": f"Đã dò xong {count} địa chỉ ({start_addr}..{start_addr+count-1}): Phát hiện và khóa {len(set(disabled_found))} thanh ghi cấm đọc ({format_addr_ranges(disabled_found) or 'Không có'}), giữ lại {count - len(set(disabled_found))} thanh ghi hợp lệ ({len(sub_blocks)} khối đọc)!"
            })
            return

        # 2. API: Modbus Write (FC05, FC06 — Hỗ trợ cả RTU và TCP)
        if path == "/api/write":
            port = resolve_req_endpoint(req, state.serial_port)
            busy = state.get_port_busy_reason(port)
            if busy:
                self.send_json({"error": busy}, 409)
                return

            baud = int(req.get("baud", state.baudrate))
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))
            slave_id = int(req.get("slave_id", 1))
            fn_code = int(req.get("fn_code", 6))
            addr = int(req.get("address", 0))
            val = req.get("value", 0)

            try:
                if fn_code == 6:
                    ok, lat, tx_hex, rx_hex = write_single_register(port, baud, slave_id, addr, int(val), parity=parity, stopbits=stopbits)
                    self.send_json({"success": ok, "port": port, "latency_ms": lat, "tx_hex": tx_hex, "rx_hex": rx_hex})
                elif fn_code == 5:
                    ok, lat, tx_hex, rx_hex = write_single_coil(port, baud, slave_id, addr, bool(val), parity=parity, stopbits=stopbits)
                    self.send_json({"success": ok, "port": port, "latency_ms": lat, "tx_hex": tx_hex, "rx_hex": rx_hex})
                else:
                    self.send_json({"error": "Chỉ hỗ trợ ghi FC05 hoặc FC06"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        # 3a. API: Register Map Explorer (RTU & TCP)
        if path == "/api/scan/registers":
            port = resolve_req_endpoint(req, state.serial_port)
            busy = state.get_port_busy_reason(port)
            if busy:
                self.send_json({"error": busy}, 409)
                return
            baud = int(req.get("baud", state.baudrate))
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))
            slave_id = int(req.get("slave_id", 1))
            fn_code = int(req.get("fn_code", 3))
            start_addr = max(0, int(req.get("start_addr", 0)))
            end_addr = min(65535, int(req.get("end_addr", 31)))
            if end_addr < start_addr:
                end_addr = start_addr
            if end_addr - start_addr > 200:
                end_addr = start_addr + 200
            timeout_sec = max(0.05, min(float(req.get("timeout_ms", 120)) / 1000.0, 1.0))

            valid_regs = []
            probed_count = 0
            cur_addr = start_addr
            chunk_size = 8
            while cur_addr <= end_addr:
                cnt = min(chunk_size, end_addr - cur_addr + 1)
                probed_count += cnt
                try:
                    req_pdu = struct.pack('>BBHH', slave_id, fn_code, cur_addr, cnt)
                    pdu, lat, _, _ = modbus_transceive(port, baud, req_pdu, timeout=timeout_sec, parity=parity, stopbits=stopbits)
                    if pdu[1] < 0x80:
                        if fn_code in (3, 4):
                            for i in range(cnt):
                                idx = 3 + i * 2
                                if idx + 2 <= len(pdu):
                                    v = struct.unpack_from('>H', pdu, idx)[0]
                                    s_v = v - 65536 if v > 32767 else v
                                    valid_regs.append({
                                        "addr": cur_addr + i, "hex_addr": f"0x{cur_addr + i:04X}",
                                        "uint16": v, "int16": s_v, "hex_val": f"0x{v:04X}", "latency": lat
                                    })
                        else:
                            for i in range(cnt):
                                byte_idx = 3 + (i // 8)
                                bit_idx = i % 8
                                b_val = ((pdu[byte_idx] >> bit_idx) & 1) if byte_idx < len(pdu) else 0
                                valid_regs.append({
                                    "addr": cur_addr + i, "hex_addr": f"0x{cur_addr + i:04X}",
                                    "uint16": b_val, "int16": b_val, "hex_val": f"Bit {b_val}", "latency": lat
                                })
                        cur_addr += cnt
                        continue
                except TimeoutError:
                    break
                except Exception:
                    pass

                for single_addr in range(cur_addr, cur_addr + cnt):
                    try:
                        req_pdu = struct.pack('>BBHH', slave_id, fn_code, single_addr, 1)
                        pdu, lat, _, _ = modbus_transceive(port, baud, req_pdu, timeout=timeout_sec, parity=parity, stopbits=stopbits)
                        if pdu[1] < 0x80:
                            if fn_code in (3, 4) and len(pdu) >= 5:
                                v = struct.unpack_from('>H', pdu, 3)[0]
                                s_v = v - 65536 if v > 32767 else v
                                valid_regs.append({
                                    "addr": single_addr, "hex_addr": f"0x{single_addr:04X}",
                                    "uint16": v, "int16": s_v, "hex_val": f"0x{v:04X}", "latency": lat
                                })
                            elif fn_code in (1, 2) and len(pdu) >= 4:
                                b_val = pdu[3] & 1
                                valid_regs.append({
                                    "addr": single_addr, "hex_addr": f"0x{single_addr:04X}",
                                    "uint16": b_val, "int16": b_val, "hex_val": f"Bit {b_val}", "latency": lat
                                })
                    except Exception:
                        pass
                cur_addr += cnt

            self.send_json({
                "success": True, "port": port, "slave_id": slave_id, "fn_code": fn_code,
                "probed_count": probed_count, "valid_count": len(valid_regs), "registers": valid_regs
            })
            return

        # 3b. API: Device Scanner (1 cổng COM, cả 8 cổng COM, hoặc Modbus TCP)
        if path in ("/api/scan", "/api/scan/multi_port"):
            port = resolve_req_endpoint(req, state.serial_port)
            scan_all = bool(req.get("scan_all_ports", False)) or (port == "ALL") or (path == "/api/scan/multi_port")
            baud = int(req.get("baud", state.baudrate))
            auto_baud = bool(req.get("auto_baud", False)) and not is_tcp_endpoint(port)
            auto_parity = bool(req.get("auto_parity", False)) and not is_tcp_endpoint(port)
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))

            start_id = int(req.get("start_id", 1))
            end_id = int(req.get("end_id", 16))
            fn_code = int(req.get("fn_code", 3))
            test_addr = int(req.get("test_addr", 0))
            quantity = int(req.get("quantity", 1))
            timeout_sec = max(0.04, min(float(req.get("timeout_ms", 120)) / 1000.0, 2.0))

            default_bauds = [9600, 19200, 38400, 115200, 57600, 4800, 2400, 1200]
            baud_list = [int(b) for b in req.get("baud_list")] if (auto_baud and req.get("baud_list")) else (default_bauds if auto_baud else [baud])
            parity_list = ["N", "E", "O"] if auto_parity else [parity]

            if scan_all:
                target_ports = [
                    p["id"] for p in discover_serial_ports()
                    if p.get("is_external") and not state.get_port_busy_reason(p["id"])
                ]
                if not target_ports:
                    self.send_json({"error": "Không có cổng COM rảnh nào để quét (tất cả đang chạy Gateway/Bridge)."}, 409)
                    return
            else:
                busy = state.get_port_busy_reason(port)
                if busy:
                    self.send_json({"error": busy}, 409)
                    return
                target_ports = [port]

            found = []
            found_lock = threading.Lock()
            scanned_steps_list = [0]

            def _scan_port_worker(t_port):
                local_found = []
                local_steps = 0
                for b in baud_list:
                    for p_mode in parity_list:
                        for sid in range(max(0, start_id), min(end_id + 1, 256)):
                            local_steps += 1
                            try:
                                dev = probe_single_slave(t_port, b, p_mode, stopbits, sid, fn_code, test_addr, quantity, timeout_sec)
                                if dev:
                                    local_found.append(dev)
                            except Exception:
                                pass
                with found_lock:
                    found.extend(local_found)
                    scanned_steps_list[0] += local_steps

            if len(target_ports) == 1:
                _scan_port_worker(target_ports[0])
            else:
                threads = [threading.Thread(target=_scan_port_worker, args=(tp,), daemon=True) for tp in target_ports]
                for t in threads:
                    t.start()
                for t in threads:
                    t.join()

            found.sort(key=lambda d: (d.get("port", ""), d.get("id", 0)))
            unique_slaves = len(set((d.get("port"), d.get("id")) for d in found))

            self.send_json({
                "success": True,
                "scan_all_ports": scan_all,
                "scanned_ports": target_ports,
                "scanned_steps": scanned_steps_list[0],
                "found": found,
                "found_count": len(found),
                "unique_slaves": unique_slaves,
                "tested_bauds": baud_list,
                "tested_parities": parity_list,
                "test_fn": fn_code,
                "test_addr": test_addr
            })
            return

        # 3b-TCP. API: Dedicated Modbus TCP / RTU-over-TCP Scanner & Tester
        if path == "/api/scan/tcp":
            mode = str(req.get("mode") or "quick_test").strip().lower()
            proto = str(req.get("protocol") or req.get("conn_type") or "tcp").strip().lower()
            proto = "rtuovertcp" if proto in ("rtuovertcp", "rtu_over_tcp", "rtu_tcp") else "tcp"
            host = str(req.get("host") or req.get("tcp_host") or "127.0.0.1").strip()
            tcp_port = int(req.get("tcp_port", 502))
            fn_code = int(req.get("fn_code", 3))
            test_addr = max(0, min(65535, int(req.get("test_addr", 0))))
            quantity = max(1, min(120, int(req.get("quantity", 1))))
            timeout_sec = max(0.08, min(float(req.get("timeout_ms", 350)) / 1000.0, 3.0))

            # CHẾ ĐỘ 1: QUICK PING & TEST 1 LỆNH MODBUS TCP / RTU-OVER-TCP
            if mode == "quick_test":
                unit_id = max(0, min(255, int(req.get("unit_id", req.get("slave_id", 1)))))
                ep_url = f"{proto}://{host}:{tcp_port}"
                t_conn0 = time.time()
                tcp_open = False
                conn_err = ""
                try:
                    s_test = socket.create_connection((host, tcp_port), timeout=timeout_sec)
                    s_test.close()
                    tcp_open = True
                except Exception as ce:
                    conn_err = str(ce)
                connect_ms = int((time.time() - t_conn0) * 1000)

                if not tcp_open:
                    self.send_json({
                        "success": False,
                        "mode": "quick_test",
                        "tcp_reachable": False,
                        "modbus_ok": False,
                        "endpoint": ep_url,
                        "host": host,
                        "tcp_port": tcp_port,
                        "protocol": proto,
                        "unit_id": unit_id,
                        "connect_ms": connect_ms,
                        "status": "TCP_UNREACHABLE",
                        "error": f"Không thể mở kết nối TCP tới {host}:{tcp_port} ({conn_err}). Hãy kiểm tra IP hoặc bật Gateway!",
                    })
                    return

                try:
                    req_pdu = struct.pack('>BBHH', unit_id, fn_code, test_addr, quantity)
                    pdu, lat, tx_hex, rx_hex = modbus_tcp_transceive(ep_url, req_pdu, timeout=timeout_sec)
                    resp_sid = pdu[0]
                    resp_fn = pdu[1]
                    if resp_fn >= 0x80:
                        exc_code = pdu[2] if len(pdu) > 2 else 0
                        self.send_json({
                            "success": True,
                            "mode": "quick_test",
                            "tcp_reachable": True,
                            "modbus_ok": True,
                            "status": "ONLINE_EXCEPTION",
                            "endpoint": ep_url,
                            "host": host,
                            "tcp_port": tcp_port,
                            "protocol": proto,
                            "unit_id": unit_id,
                            "resp_unit_id": resp_sid,
                            "fn_code": fn_code,
                            "test_addr": test_addr,
                            "quantity": quantity,
                            "connect_ms": connect_ms,
                            "latency_ms": lat,
                            "tx_hex": tx_hex,
                            "rx_hex": rx_hex,
                            "exception_code": exc_code,
                            "values": [],
                            "message": f"Kết nối TCP {host}:{tcp_port} THÀNH CÔNG ({lat}ms)! Thiết bị Unit ID {unit_id} phản hồi Exception 0x{exc_code:02X} tại địa chỉ {test_addr}."
                        })
                        return

                    vals = []
                    if resp_fn in (3, 4) and len(pdu) >= 3:
                        for i in range(quantity):
                            idx = 3 + i * 2
                            if idx + 2 <= len(pdu):
                                vals.append(struct.unpack_from('>H', pdu, idx)[0])
                    elif resp_fn in (1, 2) and len(pdu) >= 3:
                        for i in range(quantity):
                            b_idx = 3 + (i // 8)
                            bit_i = i % 8
                            vals.append(((pdu[b_idx] >> bit_i) & 1) if b_idx < len(pdu) else 0)

                    self.send_json({
                        "success": True,
                        "mode": "quick_test",
                        "tcp_reachable": True,
                        "modbus_ok": True,
                        "status": "ONLINE",
                        "endpoint": ep_url,
                        "host": host,
                        "tcp_port": tcp_port,
                        "protocol": proto,
                        "unit_id": unit_id,
                        "resp_unit_id": resp_sid,
                        "fn_code": fn_code,
                        "test_addr": test_addr,
                        "quantity": quantity,
                        "connect_ms": connect_ms,
                        "latency_ms": lat,
                        "tx_hex": tx_hex,
                        "rx_hex": rx_hex,
                        "values": vals,
                        "message": f"Đọc Modbus {'TCP (MBAP)' if proto == 'tcp' else 'RTU-over-TCP'} {host}:{tcp_port} (Unit ID {unit_id}) THÀNH CÔNG ({lat}ms): {vals}"
                    })
                except Exception as me:
                    self.send_json({
                        "success": False,
                        "mode": "quick_test",
                        "tcp_reachable": True,
                        "modbus_ok": False,
                        "status": "TCP_OPEN_NO_MODBUS",
                        "endpoint": ep_url,
                        "host": host,
                        "tcp_port": tcp_port,
                        "protocol": proto,
                        "unit_id": unit_id,
                        "connect_ms": connect_ms,
                        "error": f"Cổng TCP {host}:{tcp_port} ĐANG MỞ ({connect_ms}ms), nhưng thiết bị Unit ID {unit_id} không phản hồi gói Modbus ({me}). Hãy thử đổi Giao thức (MBAP <-> RTU-over-TCP) hoặc quét dải Unit ID!"
                    })
                return

            # CHẾ ĐỘ 2: QUÉT DẢI UNIT ID TRÊN 1 ĐỊA CHỈ IP:PORT
            if mode == "unit_scan":
                ep_url = f"{proto}://{host}:{tcp_port}"
                start_id = max(0, min(255, int(req.get("start_id", 1))))
                end_id = max(0, min(255, int(req.get("end_id", 16))))
                if end_id < start_id:
                    end_id = start_id
                include_0_255 = bool(req.get("include_0_255", req.get("include_special_ids", False)))

                # Kiểm tra nhanh socket TCP trước khi quét hàng loạt Unit ID
                t_conn0 = time.time()
                try:
                    s_chk = socket.create_connection((host, tcp_port), timeout=timeout_sec)
                    s_chk.close()
                except Exception as ce:
                    self.send_json({
                        "error": f"Cổng TCP {host}:{tcp_port} đang đóng hoặc không truy cập được ({ce}). Không thể quét Unit ID."
                    }, 504)
                    return
                connect_ms = int((time.time() - t_conn0) * 1000)

                id_list = list(range(start_id, end_id + 1))
                if include_0_255:
                    if 0 not in id_list:
                        id_list.insert(0, 0)
                    if 255 not in id_list:
                        id_list.append(255)

                found = []
                for sid in id_list:
                    try:
                        dev = probe_single_slave(ep_url, 0, "N", 1, sid, fn_code, test_addr, quantity, timeout_sec)
                        if dev:
                            dev["host"] = host
                            dev["tcp_port"] = tcp_port
                            dev["protocol"] = proto
                            found.append(dev)
                    except Exception:
                        pass

                self.send_json({
                    "success": True,
                    "mode": "unit_scan",
                    "endpoint": ep_url,
                    "host": host,
                    "tcp_port": tcp_port,
                    "protocol": proto,
                    "connect_ms": connect_ms,
                    "scanned_steps": len(id_list),
                    "found": found,
                    "found_count": len(found),
                    "unique_slaves": len(found),
                    "test_fn": fn_code,
                    "test_addr": test_addr
                })
                return

            # CHẾ ĐỘ 3: QUÉT DẢI IP MẠNG LAN / SUBNET & CỔNG TCP (IP SWEEP)
            if mode == "ip_sweep":
                subnet_prefix = str(req.get("subnet_prefix") or "192.168.10.").strip()
                if not subnet_prefix.endswith("."):
                    parts = subnet_prefix.split(".")
                    if len(parts) >= 3:
                        subnet_prefix = ".".join(parts[:3]) + "."
                ip_start = max(1, min(254, int(req.get("ip_start", 1))))
                ip_end = max(1, min(254, int(req.get("ip_end", 254))))
                if ip_end < ip_start:
                    ip_end = ip_start

                raw_ports = req.get("tcp_ports") or "502, 5000, 5001-5008"
                port_set = set()
                if isinstance(raw_ports, list):
                    for p in raw_ports:
                        try:
                            port_set.add(int(p))
                        except Exception:
                            pass
                else:
                    for token in str(raw_ports).replace(";", ",").split(","):
                        tok = token.strip()
                        if not tok:
                            continue
                        if "-" in tok:
                            a, b = tok.split("-", 1)
                            try:
                                for p_num in range(int(a), int(b) + 1):
                                    if 1 <= p_num <= 65535:
                                        port_set.add(p_num)
                            except Exception:
                                pass
                        else:
                            try:
                                p_num = int(tok)
                                if 1 <= p_num <= 65535:
                                    port_set.add(p_num)
                            except Exception:
                                pass
                if not port_set:
                    port_set = {502, 5000}
                ports_sorted = sorted(port_set)[:20]

                probe_unit_id = max(0, min(255, int(req.get("unit_id", 1))))
                connect_timeout = max(0.06, min(float(req.get("connect_timeout_ms", 160)) / 1000.0, 1.0))

                targets = []
                for last_oct in range(ip_start, ip_end + 1):
                    ip_str = f"{subnet_prefix}{last_oct}"
                    for tp in ports_sorted:
                        targets.append((ip_str, tp))

                found = []
                found_lock = threading.Lock()
                idx_lock = threading.Lock()
                task_idx = [0]
                total_targets = len(targets)

                def _ip_sweep_worker():
                    while True:
                        with idx_lock:
                            if task_idx[0] >= total_targets:
                                return
                            t_ip, t_port = targets[task_idx[0]]
                            task_idx[0] += 1
                        t0 = time.time()
                        try:
                            s = socket.create_connection((t_ip, t_port), timeout=connect_timeout)
                            s.close()
                        except Exception:
                            continue
                        tcp_lat = int((time.time() - t0) * 1000)
                        ep = f"{proto}://{t_ip}:{t_port}"
                        dev_entry = None
                        try:
                            dev_entry = probe_single_slave(ep, 0, "N", 1, probe_unit_id, fn_code, test_addr, quantity, timeout_sec)
                        except Exception:
                            dev_entry = None

                        if dev_entry:
                            dev_entry["host"] = t_ip
                            dev_entry["tcp_port"] = t_port
                            dev_entry["protocol"] = proto
                            with found_lock:
                                found.append(dev_entry)
                        else:
                            with found_lock:
                                found.append({
                                    "id": probe_unit_id,
                                    "port": ep,
                                    "port_label": f"TCP {t_ip}:{t_port}",
                                    "host": t_ip,
                                    "tcp_port": t_port,
                                    "protocol": proto,
                                    "baud": 0,
                                    "parity": "N",
                                    "stopbits": 1,
                                    "framing": f"TCP Port Mở ({t_ip}:{t_port})",
                                    "fn_code": fn_code,
                                    "addr": test_addr,
                                    "status": "TCP_OPEN_ONLY",
                                    "is_online": True,
                                    "latency": tcp_lat,
                                    "detail": f"Cổng TCP {t_ip}:{t_port} ĐANG MỞ ({tcp_lat}ms) — Chưa phản hồi Unit ID {probe_unit_id}",
                                    "value_display": "[TCP OPEN]",
                                    "raw_rx": ""
                                })

                num_workers = min(28, max(1, total_targets))
                workers = [threading.Thread(target=_ip_sweep_worker, daemon=True) for _ in range(num_workers)]
                for w in workers:
                    w.start()
                for w in workers:
                    w.join()

                found.sort(key=lambda x: (x.get("host", ""), x.get("tcp_port", 0), x.get("id", 0)))
                self.send_json({
                    "success": True,
                    "mode": "ip_sweep",
                    "subnet_prefix": subnet_prefix,
                    "ip_range": f"{subnet_prefix}{ip_start}..{ip_end}",
                    "tcp_ports": ports_sorted,
                    "scanned_steps": total_targets,
                    "found": found,
                    "found_count": len(found),
                    "unique_slaves": len(found),
                    "test_fn": fn_code,
                    "test_addr": test_addr
                })
                return

        # 3c. API: Gateway (Single, 8-Port Batch, Auto-Start on Boot)
        if path == "/api/gateway/autostart":
            state.auto_start_gateways = bool(req.get("enabled", False))
            state.save_persistent_config()
            self.send_json({"success": True, "auto_start_gateways": state.auto_start_gateways})
            return

        if path == "/api/gateway/start":
            port = req.get("port", state.serial_port)
            baud = int(req.get("baud", state.baudrate))
            parity = (req.get("parity", getattr(state, "parity", "N")) or "N").upper()
            stopbits = int(req.get("stopbits", getattr(state, "stopbits", 1)))
            default_tcp = 5000
            if port.startswith("/dev/ttyCH"):
                try:
                    default_tcp = 5001 + int(port.replace("/dev/ttyCH", ""))
                except Exception:
                    pass
            tcp_port = int(req.get("tcp_port", default_tcp))

            gw = start_gateway_for_port(port, tcp_port, baud=baud, parity=parity, stopbits=stopbits)
            if not gw.running:
                self.send_json({"error": f"Không thể mở cổng TCP {tcp_port} (có thể đang bận)."}, 500)
                return

            self.send_json({
                "success": True, "gateway": gw.to_dict(), "gateway_port": tcp_port,
                "serial_port": port, "baud": baud, "gateways": state.get_gateways_list(),
                "interfaces": get_network_interfaces()
            })
            return

        if path == "/api/gateway/start_all":
            configs = req.get("configs")
            if not configs:
                configs = [
                    {"port": p["id"], "tcp_port": p.get("default_tcp_port", 5001), "baud": int(req.get("baud", 9600)), "parity": req.get("parity", "N"), "stopbits": int(req.get("stopbits", 1))}
                    for p in discover_serial_ports() if p.get("is_ch348")
                ]
            if not configs:
                self.send_json({"error": "Không tìm thấy Bộ 8 Cổng COM (CH348) để bật đồng loạt."}, 404)
                return

            try:
                os.system("iptables -C input_rule -p tcp --dport 5000:5015 -j ACCEPT >/dev/null 2>&1 || iptables -I input_rule -p tcp --dport 5000:5015 -j ACCEPT >/dev/null 2>&1")
            except Exception:
                pass

            started = []
            for cfg in configs:
                gw = start_gateway_for_port(
                    cfg["port"], int(cfg["tcp_port"]),
                    baud=int(cfg.get("baud", 9600)), parity=cfg.get("parity", "N"), stopbits=int(cfg.get("stopbits", 1))
                )
                if gw.running:
                    started.append(gw.to_dict())

            self.send_json({
                "success": True, "started_count": len(started),
                "gateways": state.get_gateways_list(), "interfaces": get_network_interfaces()
            })
            return

        if path in ("/api/gateway/stop", "/api/gateway/stop_all"):
            target_port = None if path == "/api/gateway/stop_all" else req.get("port")
            if req.get("all"):
                target_port = None
            stop_gateway_for_port(target_port)
            self.send_json({
                "success": True, "gateway_running": state.gateway_running,
                "gateways": state.get_gateways_list(), "interfaces": get_network_interfaces(),
                "message": "Đã dừng Cầu nối Gateway."
            })
            return

        # 3d. API: Smart Unified TCP Router (:5000 Virtual ID Remapper / Route Table)
        if path == "/api/gateway/smart_router/start":
            tcp_port = int(req.get("tcp_port", 5000))
            mode = req.get("mode", "virtual_id")
            base_uid = int(req.get("base_unit_id", 1))
            real_sid = int(req.get("real_slave_id", 1))
            port_configs = req.get("port_configs")
            routes = req.get("routes")
            sr = start_smart_router(tcp_port, mode, base_uid, real_sid, port_configs, routes)
            if not sr.running:
                self.send_json({"error": f"Không thể mở cổng TCP {tcp_port} cho Smart Hub."}, 500)
                return
            self.send_json({
                "success": True,
                "smart_router": sr.to_dict(),
                "interfaces": get_network_interfaces()
            })
            return

        if path == "/api/gateway/smart_router/stop":
            stop_smart_router()
            self.send_json({"success": True, "smart_router": state.get_smart_router_status()})
            return

        # 3e. API: COM-to-COM RS485 Baudrate / Framing Converter
        if path == "/api/bridge/com2com/start":
            try:
                br = start_com_bridge(
                    req.get("master_port", "/dev/ttyCH0"),
                    int(req.get("master_baud", 9600)),
                    req.get("master_parity", "N"),
                    int(req.get("master_stopbits", 1)),
                    req.get("slave_port", "/dev/ttyCH1"),
                    int(req.get("slave_baud", 115200)),
                    req.get("slave_parity", "N"),
                    int(req.get("slave_stopbits", 1))
                )
                self.send_json({"success": True, "bridge": br.to_dict(), "com_bridges": state.get_com_bridges_list()})
            except Exception as e:
                self.send_json({"error": str(e)}, 400)
            return

        if path == "/api/bridge/com2com/stop":
            stop_com_bridge(bridge_id=req.get("id"))
            self.send_json({"success": True, "com_bridges": state.get_com_bridges_list()})
            return

        # 4. API: Datalogger Start / Stop (Single & Multi-Port Concurrent Channels)
        if path == "/api/datalog/start":
            if state.logger_running:
                self.send_json({"error": "Datalogger đang ghi phiên hiện tại."}, 409)
                return
            try:
                sess_id, sdir = start_datalogger_from_dict(req)
                self.send_json({
                    "success": True,
                    "session_id": sess_id,
                    "storage": sdir,
                    "batch_size": state.datalog_batch_size,
                    "channels_count": len(state.logger_config.get("channels") or []) or 1
                })
            except Exception as e:
                self.send_json({"error": str(e)}, 409)
            return

        if path == "/api/datalog/stop":
            if not state.logger_running:
                self.send_json({"success": True, "message": "Logger chưa chạy."})
                return
            state.logger_stop_evt.set()
            if state.logger_thread:
                state.logger_thread.join(timeout=3.0)
            state.logger_running = False

            sdir = get_storage_dir()
            db_path = os.path.join(sdir, "nxmodbus_datalog.db")
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("UPDATE datalog_sessions SET is_active = 0, stopped_at = ? WHERE id = ?",
                        (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), state.current_session_id))
            conn.commit()
            conn.close()
            self.send_json({"success": True, "session_id": state.current_session_id})
            return

        self.send_json({"error": "Unknown API"}, 404)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name = "192.168.10.1"
        self.server_port = self.server_address[1]


def main():
    state.load_persistent_config()

    if ch348_hub is not None:
        ch348_hub.start()
        if ch348_hub.online and not os.path.exists("/dev/ttyUSB1"):
            state.serial_port = "/dev/ttyCH0"

    init_db()

    # Auto-restore saved Multi-Port Gateways on boot if enabled
    if state.auto_start_gateways and state.saved_gateways:
        print(f"[*] Auto-restoring {len(state.saved_gateways)} saved TCP Gateways on boot...")
        for gcfg in state.saved_gateways:
            try:
                start_gateway_for_port(
                    gcfg["port"], int(gcfg["tcp_port"]),
                    baud=int(gcfg.get("baud", 9600)),
                    parity=gcfg.get("parity", "N"),
                    stopbits=int(gcfg.get("stopbits", 1))
                )
            except Exception as e:
                print(f"[!] Auto-start gateway error ({gcfg}): {e}")

    server = ThreadedHTTPServer(("0.0.0.0", PORT_WEB), StudioHandler)
    print("=====================================================")
    print("  NXChieu Modbus Web Studio Pro v3.3.5 (Multi-Port Edge)")
    print(f"  WireGuard URL: http://10.212.156.12:{PORT_WEB}")
    print(f"  LAN URL:       http://192.168.10.1:{PORT_WEB}")
    print(f"  AI Spec Endpoint: http://10.212.156.12:{PORT_WEB}/api/ai/spec")
    if ch348_hub and ch348_hub.online:
        print(f"  CH348 8-Port Hub: ONLINE ({ch348_hub.chip_type} Ver 0x{ch348_hub.chip_ver:02X} -> /dev/ttyCH0..7)")
    print(f"  SD Card Storage: {get_storage_dir()}")
    print("=====================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop_gateway_for_port(None)
        stop_smart_router()
        stop_com_bridge()
        state.logger_stop_evt.set()
        if ch348_hub is not None:
            ch348_hub.stop()
        server.server_close()


if __name__ == "__main__":
    main()
