# NXChieu Modbus Tool (2-in-1 Master & Slave Suite)

> **Bộ công cụ truyền thông công nghiệp Modbus chuyên nghiệp 2-trong-1 (Master & Slave Server)** được phát triển bởi **Nguyễn Xuong Chiểu (nxchieu)**, tối ưu cho kỹ sư tự động hóa, SCADA, DCS, IoT và PLC.
> 
> Được xây dựng trên nền tảng **Go 1.25 + Wails v2 + React 18 + Tailwind CSS + HTML5 Canvas**, cho hiệu năng cực cao, tốc độ phản hồi mili-giây, chiếm dụng RAM chỉ ~30MB và không phụ thuộc môi trường cài đặt bên ngoài.

---

## 🌟 Tính Năng Nổi Bật

### 1. Modbus Master (Bộ Quét Telemetry & Điều Khiển)
- **Đa giao thức truyền thông:**
  - **Modbus RTU:** Quét qua cổng Serial COM vật lý hoặc bộ chuyển đổi RS485 USB với đầy đủ cài đặt Baudrate (9600 - 115200), Data bits, Parity, Stop bits.
  - **Modbus TCP:** Kết nối trực tiếp qua Ethernet/WiFi tới PLC, PAC, Gateway IP.
  - **Modbus RTU over TCP:** Kết nối tới các Serial Device Server (Moxa, USR, Waveshare...).
  - **Virtual Sim:** Tích hợp đồng hồ điện ảo 3 pha thử nghiệm tức thì không cần phần cứng.
- **Sửa giá trị trực tiếp (Inline Edit):** Nhấp chuột trái vào ô Value, gõ số (hỗ trợ thập phân hoặc Hex `0x...`) và nhấn **Enter ↵** để ghi tức thì xuống thanh ghi.
- **Đảo trạng thái tiếp điểm (1-Click Coil Toggle):** Bấm trực tiếp nút `ON (1) / OFF (0)` để gửi lệnh điều khiển tức thì.
- **Cấu hình quét linh hoạt (F8 Definition):** Quét Coils (FC 01), Discrete Inputs (FC 02), Holding Registers (FC 03), Input Registers (FC 04).
- **Giám sát khung truyền Hex (Traffic Sniffer):** Hiển thị từng byte Raw Hex TX/RX, phân tích thời gian trễ (latency ms) và bắt lỗi CRC / Exception code.

---

### 2. Modbus Slave Server (Giả Lập Thiết Bị Độc Lập)
- **Tích hợp sẵn Server:** Khởi chạy server lắng nghe kết nối từ các Master bên ngoài (SCADA, HMI, Kepware, WinCC, n8n, Python script...).
- **Hỗ trợ đầy đủ 4 vùng nhớ tiêu chuẩn Modbus:**
  - `0x` Discrete Coils (FC 01, 05, 15)
  - `1x` Discrete Inputs (FC 02)
  - `3x` Input Registers (FC 04)
  - `4x` Holding Registers (FC 03, 06, 16)
- **Bộ mô phỏng dữ liệu tự động (Simulation Engine):**
  - **Sine Wave:** Sóng hình sin dao động tuần hoàn phục vụ test biểu đồ.
  - **Increment:** Bộ đếm bậc thang tự động tăng dần.
  - **Random:** Giá trị ngẫu nhiên trong dải Min - Max.
  - **Toggle:** Tự động đảo bit ON/OFF theo chu kỳ.

---

### 3. Giải Mã Thanh Ghi Độc Lập (Per-Register Format Override)
- Cho phép **mỗi hàng thanh ghi có một định dạng giải mã riêng biệt** ngay trên cùng một Sheet:
  - `Unsigned 16-bit` & `Signed 16-bit`
  - `Hexadecimal (0x...)` & `Binary (16-bit)`
  - `Float 32 (ABCD - Big Endian)`
  - `Float 32 (CDAB - Word Swap)`
  - `Float 32 (BADC - Byte Swap)`
  - `Float 32 (DCBA - Little Endian)`
  - `Long 32 (ABCD / CDAB)`
  - `ASCII Text`
- **Tự động ghép 32-bit:** Tự động kết hợp 2 thanh ghi liên tiếp (`regs[i]` và `regs[i+1]`) thành số thực dấu chấm động chuẩn xác.
- **Hệ số Scale & Đơn vị:** Đặt riêng hệ số tỉ lệ (ví dụ `0.1`, `0.01`) và đơn vị (`V`, `A`, `kW`, `Hz`, `°C`) cho từng biến.

---

### 4. Cột Thời Gian Cập Nhật (Last Updated Timestamp)
- Hiển thị chính xác thời điểm nhận gói tin phản hồi thành công đến mili-giây (`15:04:05.123`).
- Giúp kỹ sư phân biệt ngay lập tức số liệu đang được truyền tươi mới (`fresh telemetry`) hay đường truyền bị đơ/mất gói (`stale / frozen data`).

---

### 5. Chế Độ Xem Song Song 2 Cửa Sổ (Split View Mode)
- Nút **`[ ◫ Split View ]`** chia đôi màn hình ứng dụng:
  - **Cửa sổ 1:** Sheet chính đang chọn.
  - **Cửa sổ 2:** Cho phép chọn bất kỳ Sheet nào trong dự án qua dropdown selector để so sánh đối chiếu song song.
- Cực kỳ hữu dụng để đối chiếu **Master (gửi/nhận thực tế)** với **Slave (giả lập)** hoặc so sánh 2 đồng hồ đo điện cùng lúc.

---

### 6. Biểu Đồ Xu Hướng Đa Kênh Tương Tác Động (Multi-Trace Trend Chart)
- **Phong cách MQTT Explorer:** Vẽ trực tiếp bằng HTML5 Canvas đạt 60FPS mượt mà, viền neon rực rỡ.
- **Đa kênh song song:** Bấm vào icon 📈 ở bất kỳ hàng nào để thêm/bớt kênh vào đồ thị. Mỗi kênh tự động gán một màu sắc neon riêng biệt.
- **Tương tác kéo thả & phóng to:**
  - **Move / Pan:** Nhấn giữ chuột trái và kéo ngang để tua lại xem dữ liệu quá khứ. Bấm nút **🔴 Trở Về Live** để nhảy về hiện tại.
  - **Zoom In / Zoom Out:** Dùng con lăn chuột hoặc nút Zoom để phóng to xem chi tiết từng mẫu đo hoặc thu nhỏ xem toàn cảnh.
  - **Crosshair HUD Tooltip:** Rê chuột trên canvas để kích hoạt đường gióng dọc và hiển thị hộp thông số tức thời của toàn bộ các kênh tại điểm cắt.
- **Bộ công cụ đo:** Pause / Resume đóng băng sóng dữ liệu, đo Delta P2P, Min, Max, Avg và xuất toàn bộ kênh ra file `.csv`.

---

### 7. Quản Lý Dự Án & Hướng Dẫn Tích Hợp
- **Auto-Save:** Mọi cài đặt, tên biến, định dạng, hệ số scale và các Sheet đều được lưu tự động vào `localStorage`.
- **Lưu/Mở Dự Án (.nxmodbus):** Dễ dàng xuất/nhập toàn bộ cấu hình dự án ra file JSON chuẩn để bàn giao hoặc lưu trữ.
- **Giao diện Hướng Dẫn Sử Dụng (Help Modal / F1):** Tích hợp cẩm nang vận hành chi tiết 7 chuyên đề, nhấn **`F1`** để mở bất kỳ lúc nào.

---

### 8. Bộ Quét & Thám Tử Modbus (Industrial Scanner & Explorer / F4)
- **1. Quét Địa Chỉ Slave ID (Slave ID Scanner):**
  - Quét tự động dải ID từ 1 đến 247 trên đường truyền RS485 / TCP với thời gian timeout tùy chỉnh (50 - 500ms).
  - Phân loại trạng thái thông minh: **Online (ACK)**, **Online (Modbus Exception 01/02/03)** - giúp kỹ sư nhận diện thiết bị ngay cả khi hỏi sai vùng thanh ghi, và **Offline (Timeout)**.
  - Áp dụng ngay Slave ID tìm thấy vào Sheet hiện tại chỉ với 1 cú click chuột.
- **2. Tự Động Dò Tốc Độ Truyền (Baudrate / Parity Auto-detect):**
  - Tự động thử nghiệm tất cả các tổ hợp Baudrate (`2400`, `4800`, `9600`, `19200`, `38400`, `57600`, `115200`) và Parity (`None 8N1`, `Even 8E1`, `Odd 8O1`).
  - Phát hiện tức thì cấu hình đúng của thiết bị và cung cấp nút kết nối 1-click.
- **3. Quét Thanh Ghi & Bảng Giải Mã Đa Cột Linh Hoạt (Multi-Column Inspector):**
  - Quét dải thanh ghi (0 - 1000) phát hiện vùng địa chỉ có dữ liệu.
  - Hiển thị đồng thời tất cả các dạng biểu diễn dữ liệu trên cùng một bảng: `Int16`, `UInt16`, `Int32 (ABCD / CDAB)`, `UInt32`, `Float32 (ABCD / CDAB / BADC / DCBA)`, `Int64 / UInt64 (4 thanh ghi)`, `ASCII`, `Binary`.
  - **🌊 Giải mã chuyên dụng Đồng Hồ Nước 48-bit (3 thanh ghi 16-bit / 6 bytes):**
    - **48-bit Unsigned Integer Big-Endian:** `(R0 << 32) | (R1 << 16) | R2`
    - **48-bit Unsigned Integer Little-Endian Word Swap:** `(R2 << 32) | (R1 << 16) | R0`
    - **48-bit BCD (12 Con Lăn Cơ Khí):** Giải mã 6 bytes thành chuỗi số thập phân con lăn cơ học (chuẩn đồng hồ nước George Fischer, Zenner, Kent/Elster...).
  - **Bộ chọn cột động (Dynamic Column Selector):** Cho phép bật/tắt hiển thị từng cột tùy ý, có các preset nhanh: Chuẩn PLC/Inverter, Đồng hồ nước, hoặc Bật tất cả.
  - Xuất toàn bộ bảng giải mã đa cột ra tệp **CSV** phục vụ lập báo cáo và nghiệm thu công trình.

---

## ⌨️ Phím Tắt Nhanh (Hotkeys)

| Phím Tắt | Chức Năng |
|:---:|---|
| **F1** | Mở / Đóng Hướng dẫn sử dụng chi tiết (Help Modal) |
| **F3** | Kết nối / Ngắt kết nối cổng truyền thông (Connect / Disconnect) |
| **F4** | Mở Bộ Quét & Thám Tử Modbus (Slave ID, Baudrate, Register Scanner) |
| **F7** | Đọc đơn lẻ 1 khung quét (Read Once) |
| **F8** | Mở hộp thoại cài đặt khung đọc (Poll Definition Setup) |
| **Enter ↵** | Ghi giá trị xuống thanh ghi (khi đang nhập trực tiếp tại ô Value) |
| **Esc** | Đóng các cửa sổ Modal hoặc hủy bỏ chế độ sửa giá trị |


---

## 🛠️ Hướng Dẫn Cài Đặt & Biên Dịch (Build)

### Yêu Cầu Môi Trường
- **Go:** Phiên bản `>= 1.21`
- **Node.js:** Phiên bản `>= 18`
- **Wails CLI:** `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **WebView2:** Đã tích hợp sẵn trên Windows 10/11

### Các Lệnh Biên Dịch

```bash
# 1. Cài đặt các gói phụ thuộc Frontend
npm install

# 2. Chạy ứng dụng ở chế độ Live Development
wails dev

# 3. Biên dịch bản Production Standalone (.exe)
wails build -clean
```

File thực thi sau khi biên dịch nằm tại:
`build/bin/NXChieu-modbus-tool.exe` (~11.9 MB, chạy trực tiếp không cần cài đặt).

---

## 👤 Tác Giả & Bản Quyền
- Tác giả: **Nguyễn Xuong Chiểu (nxchieu)**
- Dự án: **NXChieu Modbus Tool**
- Giấy phép: MIT License
