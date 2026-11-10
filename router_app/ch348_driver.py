#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WCH CH348 (VID=1a86, PID=55d9) Userspace Octal-UART Driver & PTY Multiplexer
Designed for OpenWrt MIPS / Linux Embedded Gateways without kernel ch348.ko.
Supports 8 independent UART ports (/dev/ttyCH0 .. /dev/ttyCH7) concurrently
with full hardware Baudrate (1200..921600+), Parity (N/O/E), StopBits (1/2),
sub-millisecond Condition wakeup, PTY symlink bridging, and USB hotplug recovery.
"""

import os
import sys
import glob
import time
import pty
import array
import fcntl
import select
import struct
import random
import platform
import threading

CH348_VID = "1a86"
CH348_PID = "55d9"
CH348_MAX_PORTS = 8

CMD_W_R = 0xC0
CMD_W_BR = 0x80
CMD_WB_E = 0x90
CMD_VER = 0x96

R_C1 = 0x01  # IER
R_C2 = 0x02  # FCR
R_C4 = 0x04  # MCR
R_UP_O = 0x9D
R_INIT = 0xA1
R_II_B2 = 0x02  # THR Empty


def _build_usbdevfs_ioctls():
    mach = platform.machine().lower()
    ptr_size = struct.calcsize("P")
    ctrl_size = struct.calcsize("=BBHHHII" if ptr_size == 4 else "=BBHHHIP")
    bulk_size = struct.calcsize("=IIII" if ptr_size == 4 else "=IIIP")
    uint_size = struct.calcsize("=I")

    if "mips" in mach:
        # arch/mips/include/uapi/asm/ioctl.h: _IOC_NONE=1, _IOC_READ=2, _IOC_WRITE=4, sizebits=13
        def _ioc(d, t, nr, sz):
            return ((d << 29) | (sz << 16) | (ord(t) << 8) | nr) & 0xFFFFFFFF
        ioc_none, ioc_r, ioc_w = 1, 2, 4
    else:
        # asm-generic/ioctl.h: _IOC_NONE=0, _IOC_WRITE=1, _IOC_READ=2, sizebits=14
        def _ioc(d, t, nr, sz):
            return ((d << 30) | (sz << 16) | (ord(t) << 8) | nr) & 0xFFFFFFFF
        ioc_none, ioc_r, ioc_w = 0, 2, 1

    return {
        "CONTROL": _ioc(ioc_r | ioc_w, 'U', 0, ctrl_size),
        "BULK": _ioc(ioc_r | ioc_w, 'U', 2, bulk_size),
        "RESETEP": _ioc(ioc_r, 'U', 3, uint_size),
        "CLAIMINTERFACE": _ioc(ioc_r, 'U', 15, uint_size),
        "RELEASEINTERFACE": _ioc(ioc_r, 'U', 16, uint_size),
        "RESET": _ioc(ioc_none, 'U', 20, 0),
        "PTR_FMT": "=I" if ptr_size == 4 else "=Q",
        "CTRL_FMT": "=BBHHHII" if ptr_size == 4 else "=BBHHHIQ",
        "BULK_FMT": "=IIII" if ptr_size == 4 else "=IIIQ",
    }


IOCTL = _build_usbdevfs_ioctls()


def _cal_outdata(buf8: bytes, rol: int, xor_val: int) -> bytes:
    """Official WCH 64-bit rotate-left + XOR obfuscation for R_INIT payload."""
    b = bytearray(buf8)
    for _ in range(rol & 0x0F):
        msb0 = 1 if (b[0] & 0x80) else 0
        for j in range(7):
            b[j] = ((b[j] << 1) & 0xFF) | (1 if (b[j + 1] & 0x80) else 0)
        b[7] = ((b[7] << 1) & 0xFF) | msb0
    for j in range(8):
        b[j] ^= (xor_val & 0xFF)
    return bytes(b)


def _cal_recv_tmt(baud: int, bpackload: bool) -> int:
    if baud <= 0 or baud >= 921600:
        return 5
    dly = (1000000 * 15) // baud
    tmt = (dly // 100) + 1
    if bpackload and baud < 9600:
        tmt = max(5, tmt // 2)
    return min(255, max(5, tmt))


class CH348PortState:
    def __init__(self, port_num: int):
        self.port_num = port_num
        self.dev_name = f"/dev/ttyCH{port_num}"
        self.baudrate = 9600
        self.parity = "N"
        self.stopbits = 1
        self.configured = False

        self.rx_cond = threading.Condition()
        self.rx_buf = bytearray()

        self.tx_empty_evt = threading.Event()
        self.tx_empty_evt.set()
        self.init_ack_evt = threading.Event()

        self.active_adapter_count = 0
        self.pty_master_fd = None
        self.pty_slave_fd = None
        self.pty_slave_name = None

        # Per-port counters & live LED timestamps
        self.tx_bytes = 0
        self.rx_bytes = 0
        self.last_tx_ts = 0.0
        self.last_rx_ts = 0.0


class CH348Manager:
    """Singleton multiplexer managing a WCH CH348 8-port USB adapter."""

    def __init__(self, enable_pty: bool = True):
        self.enable_pty = enable_pty
        self.fd = None
        self.usb_dev_path = None
        self.sysfs_dir = None
        self.chip_type = "CH348"
        self.chip_ver = 0
        self.bpackload = False
        self.online = False

        # Endpoints (verified from descriptor: EP2=Data, EP1=Cmd/Status)
        self.ep_data_in = 0x82
        self.ep_data_out = 0x02
        self.ep_cmd_in = 0x81
        self.ep_cmd_out = 0x01

        self.cmd_lock = threading.Lock()
        self.tx_lock = threading.Lock()
        self.state_lock = threading.Lock()

        self.ports = [CH348PortState(i) for i in range(CH348_MAX_PORTS)]
        self._stop_evt = threading.Event()
        self._rx_thread = None
        self._status_thread = None
        self._pty_thread = None
        self._watchdog_thread = None

    def start(self):
        if self.enable_pty:
            self._setup_ptys()
        self._try_connect()
        self._rx_thread = threading.Thread(target=self._rx_data_worker, daemon=True)
        self._status_thread = threading.Thread(target=self._rx_status_worker, daemon=True)
        self._watchdog_thread = threading.Thread(target=self._hotplug_watchdog, daemon=True)
        self._rx_thread.start()
        self._status_thread.start()
        self._watchdog_thread.start()
        if self.enable_pty:
            self._pty_thread = threading.Thread(target=self._pty_tx_worker, daemon=True)
            self._pty_thread.start()

    def stop(self):
        self._stop_evt.set()
        self._disconnect()
        self._cleanup_ptys()

    def _setup_ptys(self):
        for p in self.ports:
            try:
                master_fd, slave_fd = pty.openpty()
                # Set raw mode on PTY so Linux doesn't echo or mangle 0x0D/0x0A binary Modbus bytes
                import termios
                attrs = termios.tcgetattr(slave_fd)
                attrs[0] = 0  # iflag
                attrs[1] = 0  # oflag
                attrs[2] |= termios.CS8 | termios.CREAD | termios.CLOCAL
                attrs[3] = 0  # lflag (disable ICANON, ECHO, ISIG)
                termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)

                fl = fcntl.fcntl(master_fd, fcntl.F_GETFL)
                fcntl.fcntl(master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

                slave_name = os.ttyname(slave_fd)
                p.pty_master_fd = master_fd
                p.pty_slave_fd = slave_fd
                p.pty_slave_name = slave_name

                if os.path.lexists(p.dev_name):
                    try:
                        os.unlink(p.dev_name)
                    except Exception:
                        pass
                os.symlink(slave_name, p.dev_name)
            except Exception as e:
                print(f"[CH348] PTY setup warning for port {p.port_num}: {e}")

    def _cleanup_ptys(self):
        for p in self.ports:
            if os.path.lexists(p.dev_name):
                try:
                    os.unlink(p.dev_name)
                except Exception:
                    pass
            for fd in (p.pty_master_fd, p.pty_slave_fd):
                if fd is not None:
                    try:
                        os.close(fd)
                    except Exception:
                        pass

    def _find_usb_device(self):
        for d in sorted(glob.glob("/sys/bus/usb/devices/*")):
            vid_f = os.path.join(d, "idVendor")
            pid_f = os.path.join(d, "idProduct")
            if os.path.exists(vid_f) and os.path.exists(pid_f):
                try:
                    vid = open(vid_f).read().strip().lower()
                    pid = open(pid_f).read().strip().lower()
                    if vid == CH348_VID and pid == CH348_PID:
                        busnum = int(open(os.path.join(d, "busnum")).read().strip())
                        devnum = int(open(os.path.join(d, "devnum")).read().strip())
                        return d, f"/dev/bus/usb/{busnum:03d}/{devnum:03d}"
                except Exception:
                    pass
        return None, None

    def _detect_endpoints(self, sysfs_dir: str):
        """Read endpoint order from sysfs interface :1.0 if present."""
        if_dir = f"{sysfs_dir}:1.0"
        if not os.path.isdir(if_dir):
            return
        eps = []
        for ep_d in sorted(glob.glob(os.path.join(if_dir, "ep_*"))):
            addr_f = os.path.join(ep_d, "bEndpointAddress")
            if os.path.exists(addr_f):
                try:
                    eps.append(int(open(addr_f).read().strip(), 16))
                except Exception:
                    pass
        # Standard CH348 has 0x82/0x02 for Data and 0x81/0x01 for Cmd/Status
        if 0x82 in eps and 0x02 in eps and 0x81 in eps and 0x01 in eps:
            self.ep_data_in = 0x82
            self.ep_data_out = 0x02
            self.ep_cmd_in = 0x81
            self.ep_cmd_out = 0x01

    def _usb_ctrl_in(self, fd: int, brequest: int, wvalue: int, windex: int, length: int, timeout_ms: int = 1000) -> bytes:
        buf = array.array('B', [0] * length)
        ptr = buf.buffer_info()[0]
        ctrl = array.array('B', struct.pack(IOCTL["CTRL_FMT"], 0xC0, brequest, wvalue, windex, length, timeout_ms, ptr))
        ret = fcntl.ioctl(fd, IOCTL["CONTROL"], ctrl, True)
        return bytes(buf[:ret])

    def _usb_bulk_out(self, fd: int, ep: int, payload: bytes, timeout_ms: int = 1000) -> int:
        buf = array.array('B', payload)
        ptr = buf.buffer_info()[0]
        bulk = array.array('B', struct.pack(IOCTL["BULK_FMT"], ep, len(buf), timeout_ms, ptr))
        return fcntl.ioctl(fd, IOCTL["BULK"], bulk, True)

    def _usb_bulk_in(self, fd: int, ep: int, max_len: int = 512, timeout_ms: int = 80) -> bytes:
        buf = array.array('B', [0] * max_len)
        ptr = buf.buffer_info()[0]
        bulk = array.array('B', struct.pack(IOCTL["BULK_FMT"], ep, max_len, timeout_ms, ptr))
        ret = fcntl.ioctl(fd, IOCTL["BULK"], bulk, True)
        if ret <= 0:
            return b""
        return bytes(buf[:ret])

    def _try_connect(self) -> bool:
        with self.state_lock:
            if self.online and self.fd is not None:
                return True
            sysfs_dir, dev_path = self._find_usb_device()
            if not dev_path or not os.path.exists(dev_path):
                return False
            try:
                fd = os.open(dev_path, os.O_RDWR)
                if_buf = array.array('B', struct.pack('=I', 0))
                fcntl.ioctl(fd, IOCTL["CLAIMINTERFACE"], if_buf, True)

                self._detect_endpoints(sysfs_dir)
                ver = self._usb_ctrl_in(fd, CMD_VER, 0, 0, 4, 1000)
                if len(ver) >= 2:
                    self.chip_ver = ver[0]
                    self.chip_type = "CH348Q" if (ver[1] & 0x80) else "CH348L"
                    self.bpackload = (self.chip_ver >= 0x8A)

                if self.bpackload:
                    # Enable packet upload optimization (R_UP_O = 0x9D)
                    pkt = bytes([CMD_WB_E, R_UP_O, 0x01, 0, 0, 0, 0, 0])
                    self._usb_bulk_out(fd, self.ep_cmd_out, pkt, 1000)

                self.fd = fd
                self.sysfs_dir = sysfs_dir
                self.usb_dev_path = dev_path
                self.online = True
                print(f"[CH348] Attached {self.chip_type} (Ver 0x{self.chip_ver:02X}) at {dev_path} -> 8 ports (/dev/ttyCH0..7) READY")
            except Exception as e:
                print(f"[CH348] Connect error on {dev_path}: {e}")
                return False

        # Initialize all 8 ports to their saved settings (default 9600 8N1)
        for p in self.ports:
            try:
                self.configure_port(p.port_num, p.baudrate, p.parity, p.stopbits, force=True)
            except Exception as e:
                print(f"[CH348] Init port {p.port_num} warning: {e}")
        return True

    def _disconnect(self):
        with self.state_lock:
            self.online = False
            fd = self.fd
            self.fd = None
            if fd is not None:
                try:
                    if_buf = array.array('B', struct.pack('=I', 0))
                    fcntl.ioctl(fd, IOCTL["RELEASEINTERFACE"], if_buf, True)
                except Exception:
                    pass
                try:
                    os.close(fd)
                except Exception:
                    pass
            for p in self.ports:
                p.configured = False

    def _hotplug_watchdog(self):
        while not self._stop_evt.is_set():
            time.sleep(1.5)
            sysfs_dir, dev_path = self._find_usb_device()
            if not dev_path:
                if self.online:
                    print("[CH348] USB device unplugged.")
                    self._disconnect()
            else:
                if not self.online or dev_path != self.usb_dev_path:
                    if self.online:
                        self._disconnect()
                    self._try_connect()

    def force_rescan(self, reset_usb: bool = False) -> dict:
        """Quét lại tức thời thiết bị USB CH348 (hỗ trợ Reset phần cứng USB khi treo nhiễu công nghiệp)."""
        sysfs_dir, dev_path = self._find_usb_device()
        if not dev_path:
            if self.online:
                self._disconnect()
            return self.get_status_dict()

        if reset_usb:
            self._disconnect()
            try:
                rfd = os.open(dev_path, os.O_RDWR)
                try:
                    fcntl.ioctl(rfd, IOCTL["RESET"], 0)
                finally:
                    os.close(rfd)
                time.sleep(0.35)
            except Exception as e:
                print(f"[CH348] Hardware USB reset note: {e}")
            self._try_connect()
        else:
            if not self.online or dev_path != self.usb_dev_path:
                if self.online:
                    self._disconnect()
                self._try_connect()
            else:
                # Re-verify control pipe & re-ensure PTY symlinks exist
                for p in self.ports:
                    if self.enable_pty and p.pty_slave_name and not os.path.lexists(p.dev_name):
                        try:
                            os.symlink(p.pty_slave_name, p.dev_name)
                        except Exception:
                            pass
        return self.get_status_dict()

    def _port_reg_offset(self, port_num: int) -> int:
        if port_num < 4:
            return 0x10 * port_num
        return 0x10 * (port_num - 4) + 0x08

    def configure_port(self, port_num: int, baudrate: int = 9600, parity: str = "N", stopbits: int = 1, force: bool = False):
        if port_num < 0 or port_num >= CH348_MAX_PORTS:
            raise ValueError(f"Invalid CH348 port {port_num}")
        if not self.online or self.fd is None:
            if not self._try_connect():
                raise IOError("Bộ chuyển đổi USB-8-COM (CH348) chưa được kết nối")

        p = self.ports[port_num]
        baudrate = max(1200, min(int(baudrate), 6000000))
        parity = (parity or "N").upper()
        stopbits = 2 if int(stopbits) == 2 else 1

        if not force and p.configured and p.baudrate == baudrate and p.parity == parity and p.stopbits == stopbits:
            return

        rgadd = self._port_reg_offset(port_num)
        char_fmt = 0x02 if stopbits == 2 else 0x00
        parity_map = {"N": 0, "O": 1, "E": 2, "M": 3, "S": 4}
        parity_type = parity_map.get(parity, 0)
        databits = 8
        tmt = _cal_recv_tmt(baudrate, self.bpackload)

        rol = random.randint(0, 15)
        xor_val = random.randint(0, 255)
        raw8 = struct.pack(">IBBBB", baudrate, char_fmt, parity_type, databits, tmt)
        enc8 = _cal_outdata(raw8, rol, xor_val)

        init_pkt = bytes([
            CMD_WB_E | (port_num & 0x0F),
            R_INIT,
            (port_num & 0x0F) | ((rol & 0x0F) << 4)
        ]) + enc8 + bytes([xor_val])

        p.init_ack_evt.clear()
        with self.cmd_lock:
            fd = self.fd
            if fd is None:
                raise IOError("CH348 disconnected")
            # 1. FIFO enable & clear (FCR = 0x87) + MCR OUT2 (0x08)
            self._usb_bulk_out(fd, self.ep_cmd_out, bytes([CMD_W_R, rgadd + R_C2, 0x87]), 1000)
            self._usb_bulk_out(fd, self.ep_cmd_out, bytes([CMD_W_R, rgadd + R_C4, 0x08]), 1000)
            # 2. Line coding R_INIT (12 bytes)
            self._usb_bulk_out(fd, self.ep_cmd_out, init_pkt, 1000)
            # 3. IER enable (0x0F) & force Normal UART/RS485 Auto-TNOW mode (M_NOR = 0x50, no CTS stall)
            self._usb_bulk_out(fd, self.ep_cmd_out, bytes([CMD_W_R, rgadd + R_C1, 0x0F]), 1000)
            self._usb_bulk_out(fd, self.ep_cmd_out, bytes([CMD_W_BR, rgadd + R_C4, 0x50]), 1000)
            # 4. Assert DTR & RTS
            if not (self.chip_type == "CH348Q" and port_num > 3):
                self._usb_bulk_out(fd, self.ep_cmd_out, bytes([CMD_W_BR, rgadd + R_C4, 0x01]), 1000)
                self._usb_bulk_out(fd, self.ep_cmd_out, bytes([CMD_W_BR, rgadd + R_C4, 0x11]), 1000)

        p.init_ack_evt.wait(0.05)
        p.baudrate = baudrate
        p.parity = parity
        p.stopbits = stopbits
        p.configured = True

    def write_port(self, port_num: int, data: bytes) -> int:
        if not data:
            return 0
        if not self.online or self.fd is None:
            if not self._try_connect():
                raise IOError("CH348 chưa sẵn sàng")

        p = self.ports[port_num]
        if not p.configured:
            self.configure_port(port_num, p.baudrate, p.parity, p.stopbits, force=True)

        max_chunk = 128 if p.baudrate < 9600 else 509
        total_sent = 0
        mv = memoryview(data)

        while total_sent < len(data):
            chunk = bytes(mv[total_sent: total_sent + max_chunk])
            pkt = struct.pack("<BH", port_num, len(chunk)) + chunk
            p.tx_empty_evt.clear()
            with self.tx_lock:
                fd = self.fd
                if fd is None:
                    raise IOError("CH348 mất kết nối khi đang gửi")
                self._usb_bulk_out(fd, self.ep_data_out, pkt, 1500)
            # Wait for UART THR empty interrupt or wire transmission time
            wire_time = (len(chunk) * 11.0 / max(1200, p.baudrate)) + 0.008
            p.tx_empty_evt.wait(min(0.5, max(0.015, wire_time * 2.0)))
            total_sent += len(chunk)
            p.tx_bytes += len(chunk)
            p.last_tx_ts = time.time()

        return total_sent

    def _rx_data_worker(self):
        while not self._stop_evt.is_set():
            if not self.online or self.fd is None:
                time.sleep(0.2)
                continue
            try:
                raw = self._usb_bulk_in(self.fd, self.ep_data_in, 512, 60)
                if not raw:
                    continue
                n = len(raw)
                for offset in range(0, n, 32):
                    if offset + 2 > n:
                        break
                    pnum = raw[offset]
                    plen = raw[offset + 1]
                    if pnum >= CH348_MAX_PORTS or plen == 0 or plen > 30:
                        continue
                    end_idx = min(n, offset + 2 + plen)
                    chunk = raw[offset + 2: end_idx]
                    if not chunk:
                        continue
                    p = self.ports[pnum]
                    p.rx_bytes += len(chunk)
                    p.last_rx_ts = time.time()
                    with p.rx_cond:
                        p.rx_buf.extend(chunk)
                        if len(p.rx_buf) > 16384:
                            del p.rx_buf[:-8192]
                        p.rx_cond.notify_all()
                    # Mirror to PTY only when no direct internal adapter is reading
                    if self.enable_pty and p.active_adapter_count == 0 and p.pty_master_fd is not None:
                        try:
                            os.write(p.pty_master_fd, chunk)
                        except Exception:
                            pass
            except OSError as e:
                # ETIMEDOUT is 145 on MIPS Linux, 110 on x86 Linux
                if getattr(e, "errno", 0) in (110, 145, 11, 4):
                    continue
                if getattr(e, "errno", 0) in (19, 5, 108):  # ENODEV / EIO / ESHUTDOWN
                    self._disconnect()
                time.sleep(0.02)
            except Exception:
                time.sleep(0.02)

    def _rx_status_worker(self):
        while not self._stop_evt.is_set():
            if not self.online or self.fd is None:
                time.sleep(0.25)
                continue
            try:
                raw = self._usb_bulk_in(self.fd, self.ep_cmd_in, 512, 120)
                if not raw:
                    continue
                i = 0
                n = len(raw)
                while i + 2 <= n:
                    pnum = raw[i] & 0x0F
                    reg_iir = raw[i + 1]
                    if reg_iir == R_INIT:
                        if pnum < CH348_MAX_PORTS:
                            self.ports[pnum].init_ack_evt.set()
                        i += 12
                    elif 0x97 <= reg_iir <= 0x9D or reg_iir == 0xA9:
                        i += 4
                    elif 0xA3 <= reg_iir <= 0xA7:
                        i += 10 if reg_iir == 0xA7 else 3
                    else:
                        if (reg_iir & 0x0F) == R_II_B2 and pnum < CH348_MAX_PORTS:
                            self.ports[pnum].tx_empty_evt.set()
                        i += 4 if reg_iir == 0x85 else 3
            except OSError as e:
                if getattr(e, "errno", 0) in (110, 145, 11, 4):
                    continue
                time.sleep(0.05)
            except Exception:
                time.sleep(0.05)

    def _pty_tx_worker(self):
        """Forwards writes made by external Linux apps on /dev/ttyCH0..7 out to CH348."""
        while not self._stop_evt.is_set():
            if not self.online:
                time.sleep(0.3)
                continue
            fds = [p.pty_master_fd for p in self.ports if p.pty_master_fd is not None]
            if not fds:
                time.sleep(1.0)
                continue
            try:
                rlist, _, _ = select.select(fds, [], [], 0.2)
                for rfd in rlist:
                    for p in self.ports:
                        if p.pty_master_fd == rfd:
                            try:
                                data = os.read(rfd, 256)
                                if data:
                                    self.write_port(p.port_num, data)
                            except Exception:
                                pass
                            break
            except Exception:
                time.sleep(0.1)

    def get_status_dict(self) -> dict:
        now = time.time()
        return {
            "online": self.online,
            "chip_type": self.chip_type if self.online else None,
            "chip_ver": f"0x{self.chip_ver:02X}" if self.online else None,
            "usb_path": self.usb_dev_path,
            "port_count": CH348_MAX_PORTS if self.online else 0,
            "ports": [
                {
                    "index": p.port_num,
                    "com_label": f"COM {p.port_num + 1}",
                    "device": p.dev_name,
                    "baudrate": p.baudrate,
                    "parity": p.parity,
                    "stopbits": p.stopbits,
                    "framing": f"{p.baudrate} 8{p.parity}{p.stopbits}",
                    "tx_bytes": p.tx_bytes,
                    "rx_bytes": p.rx_bytes,
                    "active_tx": (now - p.last_tx_ts) < 5.0,
                    "active_rx": (now - p.last_rx_ts) < 5.0
                }
                for p in self.ports
            ] if self.online else []
        }


class CH348VirtualSerial:
    """Drop-in pyserial-compatible object backed directly by CH348Manager."""

    def __init__(self, manager: CH348Manager, port_num: int, baudrate: int = 9600,
                 parity: str = "N", stopbits: int = 1, timeout: float = 0.8,
                 inter_byte_timeout: float = 0.04):
        self.manager = manager
        self.port_num = port_num
        self.port = f"/dev/ttyCH{port_num}"
        self.baudrate = int(baudrate)
        self.parity = (parity or "N").upper()
        self.stopbits = int(stopbits)
        self.timeout = timeout
        self.inter_byte_timeout = inter_byte_timeout
        self.is_open = False
        self._pstate = manager.ports[port_num]
        self.open()

    def open(self):
        self.manager.configure_port(self.port_num, self.baudrate, self.parity, self.stopbits)
        if not self.is_open:
            self._pstate.active_adapter_count += 1
            self.is_open = True

    def reconfigure(self, baudrate: int, parity: str = "N", stopbits: int = 1, timeout: float = None):
        if timeout is not None:
            self.timeout = timeout
        if self.baudrate != int(baudrate) or self.parity != parity.upper() or self.stopbits != int(stopbits):
            self.manager.configure_port(self.port_num, baudrate, parity, stopbits)
            self.baudrate = int(baudrate)
            self.parity = parity.upper()
            self.stopbits = int(stopbits)

    @property
    def in_waiting(self) -> int:
        with self._pstate.rx_cond:
            return len(self._pstate.rx_buf)

    def reset_input_buffer(self):
        with self._pstate.rx_cond:
            self._pstate.rx_buf.clear()

    def reset_output_buffer(self):
        pass

    def flush(self):
        pass

    def write(self, data: bytes) -> int:
        return self.manager.write_port(self.port_num, data)

    def read(self, size: int = 1) -> bytes:
        if size <= 0:
            return b""
        out = bytearray()
        deadline = time.time() + (self.timeout if self.timeout is not None else 1.0)

        with self._pstate.rx_cond:
            while len(out) < size:
                avail = len(self._pstate.rx_buf)
                if avail > 0:
                    take = min(size - len(out), avail)
                    out.extend(self._pstate.rx_buf[:take])
                    del self._pstate.rx_buf[:take]
                    if len(out) >= size:
                        break
                now = time.time()
                # Apply inter_byte_timeout once at least 1 byte has arrived
                if len(out) > 0 and self.inter_byte_timeout:
                    rem = min(deadline - now, self.inter_byte_timeout)
                else:
                    rem = deadline - now
                if rem <= 0:
                    break
                self._pstate.rx_cond.wait(rem)
                if len(out) > 0 and len(self._pstate.rx_buf) == 0 and self.inter_byte_timeout:
                    break

        return bytes(out)

    def close(self):
        if self.is_open:
            self.is_open = False
            self._pstate.active_adapter_count = max(0, self._pstate.active_adapter_count - 1)


# Global singleton instance
ch348_hub = CH348Manager(enable_pty=True)
