# AGENTS.md — NXChieu Modbus Studio Pro (PC & GL-XE300 Multi-Port Router Edition)

Tài liệu định hướng dành cho các AI Agent làm việc trên dự án **NXChieu Modbus Studio Pro** (`E:\00_Code\NXChieu-modbus-tool`) hoặc kết nối quản trị Router hiện trường qua **WireGuard VPN (`http://10.212.156.12:8098`, SSH `root@10.212.156.12`)** và **LAN nội bộ (`http://192.168.10.1:8098`, SSH `root@192.168.10.1`)**.

---

## 1. Kiến trúc Dự án (Tương Thích Ngược & Đồng Bộ Windows / Ubuntu / OpenWrt v3.3)
- **Bản PC Desktop Đa Nền Tảng — Windows & Ubuntu Linux (`Wails + Go + TypeScript`)**: `app.go`, `pkg/`, `src/` -> `NXChieu-modbus-tool.exe` (Windows) & `NXChieu-modbus-tool` (Ubuntu/Linux).
  - Hỗ trợ **Tách Khối Liên Tiếp Thông Minh (`Smart Contiguous Sub-Block Splitting`)** trong `pkg/modbus/models.go` (`BuildSubBlocks`) và `pkg/modbus/client.go` (`executeRead`), nâng giới hạn `Quantity` lên `250` thanh ghi và cho phép tích chọn `☑ Đọc / 🚫 Cấm Đọc` (`disabled_addrs`) từng dòng ngay trên bảng `DataGrid.tsx`.
  - Hỗ trợ đầy đủ **18 mức Baudrate chuẩn** (`300` đến `921600` bps) và nhận diện cổng Serial đa hệ điều hành (`COM1..COM256` trên Windows; `/dev/ttyUSB*`, `/dev/ttyACM*`, `/dev/ttyCH*` trên Ubuntu/Linux).
  - **Tương thích ngược & Liên thông 2 chiều 100% (`src/utils/projectStorage.ts`)**: Đọc trực tiếp cả file dự án Desktop cũ (`.nxmodbus`), hồ sơ đơn thiết bị (`nxmodbus-profile-v1`), lẫn hồ sơ đa cổng & gói Bundle xuất từ Router (`nxmodbus-monitor-v3.2`, `nxmodbus-monitor-v3.3`, `nxmodbus-sd-bundle-v3.3`).
- **Virtual COM Bridge (`Go`)**: `Virtual_Com/` -> `NXChieu-Virtual-COM.exe` (ánh xạ COM ảo trên Windows sang Modbus TCP Gateway).
- **Bản Nhúng Router OpenWrt & Web Studio Đa Nền Tảng (`GL.iNet GL-XE300 Puli 4G` / Ubuntu / Windows + Bộ 8 Cổng COM `WCH CH348L`) — Kiến trúc Modular v3.3**:
  - `router_app/ch348_driver.py` (`732 dòng`): Userspace `usbdevfs` Octal-UART Multiplexer cho chip `WCH CH348L/Q (1a86:55d9)`, tạo `/dev/ttyCH0` .. `/dev/ttyCH7` (`COM 1` .. `COM 8`), tự động nhận nóng USB (`1.5s`) và hỗ trợ `USBDEVFS_RESET`.
  - `router_app/sd_profile_manager.py` (`387 dòng`): Module độc lập quản lý phân tích cú pháp dải địa chỉ cấm đọc (`parse_addr_set`, `format_addr_ranges`), thuật toán tách khối lệnh liên tiếp (`build_safe_sub_blocks`), lưu trữ/đọc/giải phẫu hồ sơ bền vững trên Thẻ nhớ SD (`analyze_sd_profile_dict`).
  - `router_app/nxmodbus_server.py` (`3,381 dòng`): Multi-Port Concurrent Engine (`v3.3`) — Per-Port Lock Pool, **Smart Contiguous Sub-Block Splitting Engine**, **Thư viện Hồ sơ JSON lưu bền vững trên Thẻ nhớ SD** (`/mnt/sda1/modbus_data/profiles/`), 4-Tab Scanner (`scan_all_ports=true`), Ma trận 8 cổng TCP Gateway (`5001..5008`), Smart Unified TCP Hub (`:5000`), Cầu nối `COM ↔ COM` và Multi-COM SD Datalogger.
  - **Giao diện Web Studio Modular & Native Mobile App (`router_app/web/`)**:
    - `router_app/web/index.html` (`1,790 dòng`): Khung HTML chuẩn hóa kèm PWA / Mobile WebApp viewport (`100dvh`), thanh điều hướng đáy cho điện thoại (`.mobile-bottom-nav`), và Modal **`➕ Tự Tạo & Khai Báo Hồ Sơ Nhanh`** (`#quickProfileBuilderModal`).
    - `router_app/web/css/studio.css` (`480 dòng`): Hệ thống Design Tokens & Responsive Native Mobile (`<= 820px`: Slide-over Sidebar Drawer, Bottom Navigation Bar, Mobile Telemetry Cards, Bottom-Sheet Point Inspector).
    - `router_app/web/js/app_core.js` (`985 dòng`): Quản lý trạng thái, Polling Engine tách khối thông minh, Bảng dữ liệu & Chế độ Thẻ Mobile (`📱 Xem Thẻ Mobile / 📋 Xem Dạng Bảng`), Point Inspector và Traffic Log.
    - `router_app/web/js/scanner_gateway_datalog.js` (`835 dòng`): 4-Tab Scanner, Biểu đồ sóng Trend, Ma trận 8 cổng TCP Gateway, Smart Hub `:5000`, Cầu nối `COM↔COM`, Multi-Port Datalogger và Telemetry phần cứng Router.
    - `router_app/web/js/profile_studio_and_builder.js` (`1,120 dòng`): **Trình Tạo Hồ Sơ Nhanh 1-Click** (`#quickProfileBuilderModal` với 6 mẫu thiết bị công nghiệp & khai báo nhanh nhiều Tab), **Trình Giải Phẫu Khoa Học & Sửa Trực Tiếp Hồ Sơ Thẻ Nhớ SD** (`#view-profiles` có thêm/xóa/sửa thông số Tab ngay tại chỗ), và Tài liệu Chuẩn JSON AI.

---

## 2. Quy ước Ánh Xạ Cổng Vật Lý Trên Router (`port`)
| Tên Cổng | Đường Dẫn Thiết Bị (`port`) | Cổng TCP Gateway | Ghi chú cho AI Agent |
|---|---|---|---|
| **COM 1 → COM 8** | `/dev/ttyCH0` → `/dev/ttyCH7` | `5001` → `5008` | 8 cổng RS485 độc lập trên bộ chia WCH CH348L |
| **USB-RS485 Đơn** | `/dev/ttyUSB1` | `5000` | Tự nhận FTDI, CH340/341, CP210x, PL2303 |
| **CẤM SỬ DỤNG** | `/dev/ttyUSB0`, `/dev/ttyUSB2..5` | — | MCU quản lý Pin nội bộ & Modem 4G Quectel EG25-G |

---

## 3. Chuẩn File JSON Theo Dõi (`nxmodbus-monitor-v3.3` — Hỗ Trợ Cấm Đọc Giữa & Lưu Thẻ Nhớ SD)
Khi người dùng yêu cầu AI tạo file `.json` theo dõi thiết bị Modbus (từ datasheet, ảnh chụp hoặc bảng thanh ghi):
- **Xử lý thiết bị cấm đọc thanh ghi ở giữa (Hitachi HISCREW NEXT II, Deep Sea DSE8610 MKII...)**: Không cần tách rời thành hàng chục Tab nhỏ. Hãy khai báo 1 Tab gộp (`count` lên tới `250`) và liệt kê các địa chỉ bị cấm vào `disabled_addrs` (dạng mảng `[3, 4, 5, 8]` hoặc chuỗi `"3-5, 8-10, 12"`), hoặc đặt `"only_tagged": true`. Engine sẽ tự động tách thành các khối lệnh liên tiếp hợp lệ (`Contiguous Sub-Blocks`) và **tuyệt đối không gửi lệnh Modbus chạm vào địa chỉ bị cấm**.
- **Lưu trữ bền vững trên Thẻ nhớ SD**: Mọi file JSON nạp qua Web UI (`📥 Nhập JSON`) hoặc đẩy qua `POST /api/profile/apply` đều được tự động lưu vào `/mnt/sda1/modbus_data/profiles/<profile_name>.json` và có thể mở lại nhanh bằng 1 cú nhấp chuột.

```json
{
  "schema": "nxmodbus-monitor-v3.3",
  "profile_name": "BMS_Theo_Doi_Da_Cong",
  "port_aliases": {
    "/dev/ttyCH0": "Máy Nén Khí Hitachi NEXT II",
    "/dev/ttyCH1": "Máy Phát Deep Sea DSE8610"
  },
  "polling_tabs": [
    {
      "name": "COM 1 • Hitachi NEXT II (Né Ô Cấm Giữa)",
      "port": "/dev/ttyCH0",
      "baud": 19200,
      "parity": "E",
      "stopbits": 1,
      "slave_id": 1,
      "fn_code": 3,
      "start_addr": 2,
      "count": 29,
      "disabled_addrs": "3-5, 8-10, 12, 17-18",
      "only_tagged": false,
      "format": "uint16",
      "scan_ms": 1000,
      "auto_poll": false,
      "tags": { "0": "Áp suất khí xả P1", "4": "Nhiệt độ đầu nén TH1", "11": "Dòng điện Motor" },
      "units": { "0": "MPa", "4": "°C", "11": "A" },
      "scales": { "0": 0.01, "4": 1.0, "11": 1.0 }
    }
  ],
  "datalogger": {
    "auto_start": false,
    "name": "Log_Da_Cong_24h",
    "interval_sec": 2,
    "batch_size": 30,
    "channels": [
      {
        "label": "COM1_Hitachi",
        "port": "/dev/ttyCH0",
        "baud": 19200,
        "parity": "E",
        "stopbits": 1,
        "slave_id": 1,
        "fn_code": 3,
        "start_addr": 2,
        "count": 15,
        "disabled_addrs": "3-5, 8-10, 12",
        "tags": { "0": "P1_MPa", "4": "TH1_C", "11": "Motor_A" },
        "scales": { "0": 0.01, "4": 1.0, "11": 1.0 },
        "units": { "0": "MPa", "4": "C", "11": "A" }
      }
    ]
  }
}
```

- **Tra cứu, Giải phẫu & Import/Export Hồ sơ Thẻ nhớ SD (`/mnt/sda1/modbus_data/profiles/` — Quản trị linh hoạt qua WireGuard `10.212.156.12` hoặc LAN `192.168.10.1`)**:
  - `GET http://10.212.156.12:8098/api/ai/spec` (hoặc `http://192.168.10.1:8098/api/ai/spec`) — Lấy toàn bộ JSON Schema v3.3, danh sách cổng thực tế và danh sách hồ sơ trên Thẻ nhớ SD.
  - `GET http://10.212.156.12:8098/api/profile/list` — Liệt kê các file JSON đang lưu trong `/mnt/sda1/modbus_data/profiles/` kèm thống kê số Tab, số điểm Tag, số địa chỉ cấm đọc.
  - `GET http://10.212.156.12:8098/api/profile/get?file=<filename>` — Giải phẫu chi tiết 1 hồ sơ trên Thẻ nhớ SD (kèm sơ đồ tách khối `sub_blocks` của từng Tab) mà không làm gián đoạn phiên Polling đang chạy.
  - `POST http://10.212.156.12:8098/api/profile/import` — Import 1 hoặc nhiều hồ sơ (hoặc gói Bundle) lưu thẳng vào Thẻ nhớ SD.
  - `GET http://10.212.156.12:8098/api/profile/export_all` — Xuất toàn bộ kho hồ sơ trên Thẻ nhớ SD thành 1 file Backup Bundle (`NXModbus_SD_Profiles_Bundle.json`).
  - `POST http://10.212.156.12:8098/api/profile/load` (`{"file": "Ten_Ho_So.json"}`) — Mở nhanh hồ sơ từ Thẻ nhớ SD vào Bảng Dữ Liệu (Poll).
  - `POST http://10.212.156.12:8098/api/profile/clone` & `POST /api/profile/rename` — Nhân bản hoặc đổi tên hồ sơ trực tiếp trên Thẻ nhớ SD.
  - `POST http://10.212.156.12:8098/api/poll/auto_mask` — Tự động dò và khóa các thanh ghi trả về lỗi Exception `0x02`.
  - **Triển khai tự động lên Router**: Chạy `python router_app/deploy_router.py` (tự động ưu tiên kết nối qua WireGuard `10.212.156.12`, fallback sang `192.168.10.1`).
