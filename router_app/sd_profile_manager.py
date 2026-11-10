#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SD Card Persistent Profile Manager & Contiguous Sub-Block Address Engine (v3.3)
Quản lý kho hồ sơ JSON lưu bền vững trên Thẻ nhớ SD (/mnt/sda1/modbus_data/profiles/),
thuật toán băm nhỏ khối lệnh Modbus né thanh ghi cấm đọc (disabled_addrs / only_tagged),
và đặc tả JSON Schema cho các luồng AI Agent.
"""

import os
import json
from datetime import datetime

BASE_APP_DIR = os.path.dirname(os.path.abspath(__file__))
SD_DATA_DIR = "/mnt/sda1/modbus_data"
FALLBACK_DATA_DIR = "/tmp/modbus_data"


def format_port_short(port: str) -> str:
    if not port:
        return ""
    if port.startswith("/dev/ttyCH"):
        try:
            idx = int(port.replace("/dev/ttyCH", ""))
            return f"COM{idx + 1}"
        except Exception:
            pass
    return port.replace("/dev/", "")


def parse_addr_set(spec) -> set:
    """Chuyển đổi danh sách hoặc chuỗi dải địa chỉ (VD: [3, 4, 5] hoặc '3-5, 8-10, 12') thành tập số nguyên."""
    res = set()
    if not spec:
        return res
    tokens = []
    if isinstance(spec, (list, tuple, set)):
        for item in spec:
            if isinstance(item, int):
                res.add(item)
            else:
                tokens.extend(str(item).replace(";", ",").split(","))
    else:
        tokens = str(spec).replace(";", ",").split(",")

    for tok in tokens:
        t = tok.strip()
        if not t:
            continue
        if "-" in t or ".." in t:
            sep = ".." if ".." in t else "-"
            parts = [p.strip() for p in t.split(sep, 1)]
            try:
                a = int(parts[0], 0)
                b = int(parts[1], 0)
                lo, hi = (a, b) if a <= b else (b, a)
                for addr in range(lo, min(hi + 1, lo + 2000)):
                    res.add(addr)
            except Exception:
                pass
        else:
            try:
                res.add(int(t, 0))
            except Exception:
                pass
    return res


def format_addr_ranges(addrs) -> str:
    """Rút gọn tập địa chỉ [3,4,5,8,9,10,12] thành chuỗi '3-5, 8-10, 12'."""
    nums = sorted(set(int(x) for x in (addrs or [])))
    if not nums:
        return ""
    ranges = []
    start = prev = nums[0]
    for x in nums[1:]:
        if x == prev + 1:
            prev = x
        else:
            ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
            start = prev = x
    ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
    return ", ".join(ranges)


def is_tag_map_address_keyed(tags: dict, start_addr: int) -> bool:
    """Nhận diện tự động map tags/units/scales dùng khóa theo offset ('0','1') hay theo địa chỉ tuyệt đối ('2','6')."""
    if not tags or start_addr <= 0:
        return False
    if "0" in tags or 0 in tags:
        return False
    num_keys = []
    for k in tags.keys():
        ks = str(k).strip()
        if ks.isdigit():
            num_keys.append(int(ks))
    if num_keys and all(nk >= start_addr for nk in num_keys):
        return True
    return False


def build_safe_sub_blocks(start_addr: int, count: int, disabled_addrs=None, enabled_addrs=None,
                          only_tagged: bool = False, tags: dict = None, max_chunk: int = 120):
    """
    Tự động cắt vùng đọc [start_addr .. start_addr+count-1] thành các khối con liên tiếp hợp lệ (Contiguous Sub-Blocks),
    TUYỆT ĐỐI KHÔNG BAO GIỜ chạm vào các địa chỉ bị đánh dấu cấm đọc (disabled_addrs) ở giữa!
    """
    disabled_set = parse_addr_set(disabled_addrs)
    enabled_set = parse_addr_set(enabled_addrs)

    if enabled_set:
        for i in range(count):
            addr = start_addr + i
            if addr not in enabled_set:
                disabled_set.add(addr)

    if only_tagged and isinstance(tags, dict) and len(tags) > 0:
        addr_keyed = is_tag_map_address_keyed(tags, start_addr)
        for i in range(count):
            addr = start_addr + i
            has_tag = False
            if f"@{addr}" in tags:
                has_tag = bool(str(tags[f"@{addr}"]).strip())
            elif addr_keyed:
                has_tag = bool(str(tags.get(str(addr)) or tags.get(addr) or "").strip())
            else:
                has_tag = bool(str(tags.get(str(i)) or tags.get(i) or "").strip())
            if not has_tag:
                disabled_set.add(addr)

    sub_blocks = []
    cur_offset = None
    cur_start = None
    cur_cnt = 0

    for i in range(count):
        addr = start_addr + i
        if addr in disabled_set:
            if cur_cnt > 0:
                sub_blocks.append({"offset": cur_offset, "start_addr": cur_start, "count": cur_cnt})
                cur_offset = None
                cur_start = None
                cur_cnt = 0
        else:
            if cur_cnt == 0:
                cur_offset = i
                cur_start = addr
                cur_cnt = 1
            elif cur_cnt >= max_chunk:
                sub_blocks.append({"offset": cur_offset, "start_addr": cur_start, "count": cur_cnt})
                cur_offset = i
                cur_start = addr
                cur_cnt = 1
            else:
                cur_cnt += 1

    if cur_cnt > 0:
        sub_blocks.append({"offset": cur_offset, "start_addr": cur_start, "count": cur_cnt})

    active_disabled = sorted(addr for addr in disabled_set if start_addr <= addr < start_addr + count)
    return sub_blocks, active_disabled


def get_storage_dir():
    if os.name != "nt" and os.path.ismount("/mnt/sda1") and os.access("/mnt/sda1", os.W_OK):
        d = SD_DATA_DIR
    elif os.name == "nt" or not os.path.exists("/etc/openwrt_release"):
        d = os.path.join(BASE_APP_DIR, "modbus_data")
    else:
        d = FALLBACK_DATA_DIR
    os.makedirs(d, exist_ok=True)
    return d


def get_profiles_dir():
    if os.name != "nt" and os.path.ismount("/mnt/sda1") and os.access("/mnt/sda1", os.W_OK):
        pdir = os.path.join(SD_DATA_DIR, "profiles")
    elif os.name != "nt" and os.path.isdir("/etc/nxmodbus"):
        pdir = "/etc/nxmodbus/profiles"
    elif os.name == "nt" or not os.path.exists("/etc/openwrt_release"):
        pdir = os.path.join(BASE_APP_DIR, "modbus_data", "profiles")
    else:
        pdir = os.path.join(FALLBACK_DATA_DIR, "profiles")
    os.makedirs(pdir, exist_ok=True)
    return pdir


def sanitize_profile_filename(name: str) -> str:
    raw = str(name or "Profile_Modbus").strip()
    if raw.lower().endswith(".json"):
        raw = raw[:-5]
    safe = "".join(ch if (ch.isalnum() or ch in ("_", "-", ".")) else "_" for ch in raw).strip("_.")
    if not safe:
        safe = "Profile_Modbus"
    return f"{safe[:80]}.json"


def save_sd_profile_file(profile_obj: dict, custom_filename: str = None) -> dict:
    pdir = get_profiles_dir()
    prof_name = str(profile_obj.get("profile_name") or custom_filename or "NXChieu_MultiPort_Profile").strip()
    if prof_name.lower().endswith(".json"):
        prof_name = prof_name[:-5]
    fname = sanitize_profile_filename(custom_filename or prof_name)
    fpath = os.path.join(pdir, fname)

    save_doc = dict(profile_obj)
    save_doc["schema"] = "nxmodbus-monitor-v3.3"
    save_doc["profile_name"] = prof_name
    save_doc["saved_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(save_doc, f, indent=2, ensure_ascii=False)
        f.flush()
        try:
            os.fsync(f.fileno())
        except Exception:
            pass

    return {
        "filename": fname,
        "profile_name": prof_name,
        "path": fpath,
        "size_kb": round(os.path.getsize(fpath) / 1024.0, 2),
        "updated_at": save_doc["saved_at"],
        "tabs_count": len(save_doc.get("polling_tabs") or [])
    }


def list_sd_profiles(active_name: str = "") -> list:
    pdir = get_profiles_dir()
    items = []
    try:
        files = sorted(f for f in os.listdir(pdir) if f.lower().endswith(".json"))
    except Exception:
        files = []

    for fn in files:
        fpath = os.path.join(pdir, fn)
        if not os.path.isfile(fpath):
            continue
        try:
            st = os.stat(fpath)
            size_kb = round(st.st_size / 1024.0, 2)
            mtime_str = datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            pname = str(data.get("profile_name") or fn[:-5])
            tabs = data.get("polling_tabs") or []
            ports_used = sorted(set(format_port_short(t.get("port", "")) for t in tabs if t.get("port")))
            total_registers = 0
            tagged_total = 0
            disabled_total = 0
            for t in tabs:
                cnt = max(1, int(t.get("count", 10)))
                total_registers += cnt
                t_tags = t.get("tags") or {}
                if isinstance(t_tags, dict):
                    tagged_total += sum(1 for v in t_tags.values() if str(v).strip())
                dis_raw = t.get("disabled_addrs") or t.get("skip_addrs")
                if isinstance(dis_raw, list):
                    disabled_total += len(dis_raw)
                elif isinstance(dis_raw, str) and dis_raw.strip():
                    disabled_total += len(parse_addr_set(dis_raw))
            items.append({
                "filename": fn,
                "profile_name": pname,
                "base_profile": str(data.get("base_profile") or pname.split("__v")[0]),
                "version_num": int(data.get("version_num", 1)) if str(data.get("version_num", "")).isdigit() else 1,
                "version_note": str(data.get("version_note") or ""),
                "schema": str(data.get("schema") or "nxmodbus-monitor-v3.3"),
                "tabs_count": len(tabs),
                "total_registers": total_registers,
                "tagged_total": tagged_total,
                "ports_summary": ", ".join(ports_used) if ports_used else "--",
                "disabled_total": disabled_total,
                "size_kb": size_kb,
                "updated_at": data.get("saved_at") or data.get("exported_at") or mtime_str,
                "is_active": (pname == active_name) or (fn == sanitize_profile_filename(active_name)),
                "storage": "Thẻ nhớ SD (/mnt/sda1)" if fpath.startswith("/mnt/sda1") else "Bộ nhớ Flash"
            })
        except Exception:
            continue

    items.sort(key=lambda x: x["updated_at"], reverse=True)
    items.sort(key=lambda x: not x["is_active"])
    return items


def load_sd_profile_file(filename: str) -> dict:
    pdir = get_profiles_dir()
    clean = os.path.basename(str(filename or "").strip())
    if not clean.lower().endswith(".json"):
        clean = sanitize_profile_filename(clean)
    fpath = os.path.join(pdir, clean)
    if not os.path.isfile(fpath):
        raise FileNotFoundError(f"Không tìm thấy hồ sơ '{clean}' trong thẻ nhớ SD ({pdir})")
    with open(fpath, "r", encoding="utf-8") as f:
        return json.load(f)


def delete_sd_profile_file(filename: str) -> bool:
    pdir = get_profiles_dir()
    clean = os.path.basename(str(filename or "").strip())
    fpath = os.path.join(pdir, clean)
    if os.path.isfile(fpath):
        os.remove(fpath)
        return True
    return False


def analyze_sd_profile_dict(prof_data: dict, clean_name: str = "") -> dict:
    tabs = prof_data.get("polling_tabs") or []
    tabs_analysis = []
    total_regs = 0
    total_tagged = 0
    total_disabled = 0
    total_sub_blocks = 0

    for idx, t in enumerate(tabs):
        s_addr = int(t.get("start_addr", 0))
        cnt = max(1, min(int(t.get("count", 10)), 250))
        fn_c = int(t.get("fn_code", 3))
        dis_raw = t.get("disabled_addrs") or t.get("skip_addrs")
        en_raw = t.get("enabled_addrs")
        only_tg = bool(t.get("only_tagged", False))
        t_tags = t.get("tags") or {}
        t_units = t.get("units") or {}
        t_scales = t.get("scales") or {}

        s_blocks, act_dis = build_safe_sub_blocks(
            s_addr, cnt,
            disabled_addrs=dis_raw,
            enabled_addrs=en_raw,
            only_tagged=only_tg,
            tags=t_tags,
            max_chunk=(120 if fn_c in (3, 4) else 1900)
        )
        tag_cnt = sum(1 for v in t_tags.values() if str(v).strip()) if isinstance(t_tags, dict) else 0
        total_regs += cnt
        total_tagged += tag_cnt
        total_disabled += len(act_dis)
        total_sub_blocks += len(s_blocks)

        tabs_analysis.append({
            "index": idx,
            "id": t.get("id") or f"tab_{idx + 1}",
            "name": t.get("name") or f"Kênh {idx + 1}",
            "port": t.get("port", "/dev/ttyCH0"),
            "port_label": format_port_short(t.get("port", "/dev/ttyCH0")),
            "baud": int(t.get("baud", 9600)),
            "parity": (t.get("parity", "N") or "N").upper(),
            "stopbits": int(t.get("stopbits", 1)),
            "slave_id": int(t.get("slave_id", 1)),
            "fn_code": fn_c,
            "start_addr": s_addr,
            "end_addr": s_addr + cnt - 1,
            "count": cnt,
            "enabled_count": cnt - len(act_dis),
            "disabled_count": len(act_dis),
            "disabled_addrs": act_dis,
            "disabled_ranges_str": format_addr_ranges(act_dis),
            "read_only_addrs": sorted(parse_addr_set(t.get("read_only_addrs"))),
            "only_tagged": only_tg,
            "tagged_count": tag_cnt,
            "sub_blocks": s_blocks,
            "sub_blocks_count": len(s_blocks),
            "format": t.get("format", "uint16"),
            "scan_ms": int(t.get("scan_ms", 1000)),
            "tags": t_tags,
            "units": t_units,
            "scales": t_scales,
            "controls": t.get("controls") or {}
        })

    pname = str(prof_data.get("profile_name") or (clean_name[:-5] if clean_name.endswith(".json") else clean_name))
    return {
        "profile_name": pname,
        "tabs_count": len(tabs),
        "total_registers": total_regs,
        "total_enabled": total_regs - total_disabled,
        "total_disabled": total_disabled,
        "total_tagged": total_tagged,
        "total_sub_blocks": total_sub_blocks,
        "tabs": tabs_analysis,
        "trend_watches": prof_data.get("trend_watches") or []
    }
