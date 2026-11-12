# Tài Liệu Giải Phẫu Nghiệp Vụ & Hướng Dẫn Tích Hợp Lên ESP32 (`NXChieu Modbus Studio Pro v3.3`)

Tài liệu này tổng hợp toàn bộ **nghiệp vụ cốt lõi (Core Business Logic)**, **cấu trúc dữ liệu**, **thuật toán tách khối né lỗi `0x02`**, **cơ chế điều phối đa luồng RS485** và **chuẩn giao tiếp REST API / JSON Schema `nxmodbus-monitor-v3.3`** của dự án **NXChieu Modbus Studio Pro**, kèm theo thư viện C/C++ độc lập ([`esp32_port/nxmodbus_esp32_core.h`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h)) để nhúng trực tiếp vào vi điều khiển **ESP32 / ESP32-S3 (ESP-IDF hoặc Arduino)**.

---

## 1. Kiến Trúc Tổng Thể Khi Đưa Lên ESP32 / ESP32-S3

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   GIAO DIỆN WEB STUDIO (HTML/CSS/JS GZIP)                  │
│   Tái sử dụng 100% bộ giao diện `router_app/web/` (nén .gz lưu Flash/SD)   │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ REST API JSON (`/api/status`, `/api/poll`, `/api/write`...)
┌───────────────────────────────▼────────────────────────────────────────────┐
│                ESP32 HTTP SERVER (`esp_http_server` + `cJSON`)             │
├───────────────────────┬───────────────────────────┬────────────────────────┤
│ 1. SMART POLL ENGINE  │ 2. 4-TAB SCANNER & GW     │ 3. SD PROFILE & LOGGER │
│ • Tách khối liên tiếp │ • Quét nhanh Slave 1..247 │ • Lưu/Nạp `.json` v3.3 │
│   né `disabled_addrs` │ • Quét ma trận Baud/Parity│ • Lịch sử `.versions/` │
│ • Tự động khóa `0x02` │ • Cầu nối Modbus TCP:502  │ • Ghi Batch CSV/JSONL  │
└───────────┬───────────┴─────────────┬─────────────┴────────────┬───────────┘
            │                         │                          │
┌───────────▼─────────────────────────▼──────────────────────────▼───────────┐
│        PER-UART FREERTOS MUTEX POOL + BUS TURNAROUND GUARD (15ms)          │
│   • `xSemaphoreTake(uart_mutex[port], pdMS_TO_TICKS(2000))`                │
│   • Điều khiển cứng chân `DE/RE` (`UART_MODE_RS485_HALF_DUPLEX`)           │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                        [ Bus Vật Lý RS485 (UART1 / UART2) ]
```

---

## 2. Sáu Nghiệp Vụ Cốt Lõi Của Dự Án (Core Business Logic)

### Nghiệp vụ 1: Thuật toán Tách Khối Liên Tiếp Thông Minh (`Smart Contiguous Sub-Block Splitting`)
- **Bài toán thực tế**: Nhiều thiết bị công nghiệp (máy nén khí Hitachi HISCREW NEXT II, bộ điều khiển máy phát Deep Sea DSE8610, biến tần, bo mạch STM32...) có bảng thanh ghi phân bổ rải rác từ địa chỉ `0` đến `80`, nhưng **cấm đọc các thanh ghi trống ở giữa** (nếu gửi 1 lệnh `FC03` đọc gộp từ `0..79` sẽ bị thiết bị trả về lỗi `Exception 0x02: Illegal Data Address` và mất trắng cả bảng).
- **Giải pháp nghiệp vụ**:
  1. Người dùng vẫn khai báo **1 Tab gộp duy nhất** (`start_addr = 0`, `count = 80`) và liệt kê các địa chỉ cấm vào `disabled_addrs` (ví dụ: `"19-31, 41-47, 56-63, 73-79"`).
  2. Hàm [`nxmb_build_safe_sub_blocks()`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h#L211-L273) quét qua dải `start_addr .. start_addr + count - 1`:
     - Bỏ qua mọi địa chỉ nằm trong `disabled_addrs` (đánh dấu trạng thái `NXMB_PT_SKIPPED`).
     - Gom các địa chỉ được phép đọc đứng cạnh nhau thành từng **khối liên tiếp (`nxmb_sub_block_t`)** có độ dài tối đa `max_chunk = 120` thanh ghi.
     - Ví dụ với dải `0..79` và `disabled_addrs = "19-31, 41-47, 56-63, 73-79"`, thuật toán tự động sinh ra **5 khối lệnh liên tiếp**:
       - Khối 1: `Addr 0..18` (`count = 19`, `offset = 0`)
       - Khối 2: `Addr 32..40` (`count = 9`, `offset = 32`)
       - Khối 3: `Addr 48..55` (`count = 8`, `offset = 48`)
       - Khối 4: `Addr 64..72` (`count = 9`, `offset = 64`)
  3. Sau khi đọc xong các khối con, kết quả được ghép chính xác vào mảng `out_points[0..79]` theo đúng `offset` để giao diện hiển thị liền mạch trên 1 bảng duy nhất.

---

### Nghiệp vụ 2: Cơ chế Tự Động Dò & Khóa Ô Nhớ Lỗi `0x02` (`Auto-Masking Engine`)
- Khi người dùng chưa biết thiết bị cấm đọc ở những thanh ghi nào, họ chỉ cần bật cờ `auto_mask_on_0x02 = true` trong hàm [`nxmb_execute_tab_poll()`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h#L510-L619) (hoặc nhấn nút **`🛡️ Tự Khóa Ô Lỗi 0x02`** trên giao diện):
  1. Nếu một khối con `b_start .. b_start + b_count - 1` trả về mã lỗi Modbus Exception `0x02`, Engine lập tức chuyển sang **chế độ quét đơn từng thanh ghi (`count = 1`)** trong phạm vi khối đó.
  2. Thanh ghi nào trả về dữ liệu hợp lệ sẽ được lấy giá trị ngay; thanh ghi nào trả về `0x02` sẽ tự động được đẩy vào `disabled_mask` bằng hàm [`nxmb_mask_add_range()`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h#L118-L134).
  3. Ở chu kỳ Polling kế tiếp, `disabled_mask` đã chứa các địa chỉ chết nên Engine tự động tách khối né vĩnh viễn các ô đó, tốc độ đọc nhanh trở lại như bình thường.

---

### Nghiệp vụ 3: Quản Lý Khóa Bus RS485 Đa Luồng & Chống Xung Đột Gói Tin (`Per-Port Mutex & Turnaround Delay`)
Trên hệ thống nhúng chạy đồng thời nhiều tác vụ (Web Polling + Nút nhấn Ghi Relay tức thời + Modbus TCP Gateway + SD Datalogger ngầm):
1. **Mỗi cổng UART vật lý có 1 `SemaphoreHandle_t` (Mutex) riêng biệt**.
2. **Thứ tự ưu tiên & Chống đụng độ trên Bus RS485**:
   - Trước khi phát bất kỳ gói tin nào ra UART, tác vụ bắt buộc phải giữ khóa `xSemaphoreTake(uart_mutex, pdMS_TO_TICKS(2000))`.
   - Sau khi nhận xong gói phản hồi (hoặc hết thời gian chờ `timeout_ms`), bắt buộc phải **xả sạch bộ đệm RX rác (`uart_flush_input`)** và **chờ thời gian nghỉ giữa 2 khung truyền (`inter_frame_delay_ms = 15ms` với baud `<= 19200`, hoặc `5ms` với baud `>= 38400`)** trước khi nhả Mutex `xSemaphoreGive(uart_mutex)`.
   - Nhờ vậy, khi người dùng bấm nút **Đảo trạng thái Relay (`FC06`)** trên Web trong lúc bảng đang Polling liên tục, lệnh ghi `FC06` sẽ xếp hàng ngay sau gói đọc hiện tại mà không bao giờ làm hỏng khung truyền trên đường dây A/B.

---

### Nghiệp vụ 4: Giải Mã Đa Định Dạng 16-bit / 32-bit (4 kiểu Endian) & Hệ Số `Scale`
Hàm [`nxmb_decode_value()`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h#L406-L454) xử lý thống nhất mọi kiểu dữ liệu công nghiệp:
- **16-bit**:
  - `uint16`: $V = \text{word}_0 \times \text{scale}$
  - `int16`: $V = \text{ (int16\_t) }\text{word}_0 \times \text{scale}$ (Ví dụ cảm biến nhiệt độ âm hoặc đứt dây trả về `0xFF9C = -100` $\xrightarrow{\times 0.1} -10.0^\circ\text{C}$).
- **32-bit (Ghép 2 thanh ghi liên tiếp $\text{word}_0, \text{word}_1$)**:
  - `ABCD` (`Big-Endian`): `(w0 << 16) | w1`
  - `CDAB` (`Word-Swapped` — rất phổ biến trên đồng hồ điện Schneider, Selec, Chint): `(w1 << 16) | w0`
  - `DCBA` (`Little-Endian`): Đảo toàn bộ 4 byte
  - `BADC` (`Byte-Swapped`): Đảo từng cặp byte trong mỗi word
- **Nhận diện thông minh kiểu nút điều khiển từ tên Tag ([`nxmb_infer_control_mode()`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h#L469-L501))**:
  - Tự động khóa **Chỉ đọc (`🔒 Chỉ đọc`)** với các thanh ghi cảm biến/trạng thái (`DI1_STATE`, `TEMP`, `VOLT`, `RAW_ADC`, `VDDA`, `UID_`, `UPTIME`, `CRC_ERR`).
  - Tự động sinh nút **`[BẬT (1)] [TẮT (0)]`** với các thanh ghi Relay/DO (`RL1_STATE`, `OUT12V_1`, `0=OFF`).
  - Tự động sinh nút **`[↺ Reset (0)]`** với các thanh ghi bộ đếm xung (`DI1_COUNT`).
  - Tự động sinh nút **`[⚡ 0.5s] [⚡ 1s] [⚡ 3s]`** với các thanh ghi kích xung (`PULSE_100MS`).

---

### Nghiệp vụ 5: Quản Lý Hồ Sơ JSON Trên Thẻ Nhớ SD / LittleFS & Lịch Sử Phiên Bản (`.versions/`)
- Mọi cấu hình theo dõi được lưu thành file `.json` theo chuẩn `nxmodbus-monitor-v3.3` trong thư mục `/sdcard/modbus_data/profiles/`.
- **Cơ chế chống mất cấu hình khi sửa sai (Auto-Versioning)**:
  - Mỗi khi người dùng bấm **Lưu SD** hoặc sửa cấu hình một hồ sơ đã tồn tại, trước khi ghi đè file chính `<Ten_Ho_So>.json`, hệ thống tự động tạo bản sao lưu kèm dấu thời gian vào `/sdcard/modbus_data/profiles/.versions/<Ten_Ho_So>__YYYYMMDD_HHMMSS.json` (giữ tối đa 20 bản gần nhất cho mỗi hồ sơ để tránh đầy bộ nhớ).

---

### Nghiệp vụ 6: Ghi Nhật Ký Ngâm Đa Kênh Ra Thẻ Nhớ SD (RAM-Buffered Batch Datalogger)
- **Bảo vệ tuổi thọ thẻ nhớ MicroSD / Flash trên ESP32**:
  - Tuyệt đối không mở file và `fflush()` trên thẻ nhớ ở mỗi chu kỳ đọc (1–2 giây/lần) vì sẽ làm mòn ô nhớ Flash và gây trễ SPI.
  - Dữ liệu đọc được từ các kênh sẽ được nối vào bộ đệm chuỗi trong RAM (`psram` hoặc `heap`). Khi đủ `batch_size` mẫu (mặc định `30 mẫu`) hoặc quá `30 giây` (hoặc khi phát hiện sụt áp nguồn 24V/Pin yếu), hệ thống mới mở file `/sdcard/modbus_data/logs/<session>.csv` để ghi gộp 1 lần duy nhất.

---

## 3. Code Mẫu Tích Hợp Trực Tiếp Vào Dự Án ESP-IDF (`main.c`)

Bạn chỉ cần copy file [`esp32_port/nxmodbus_esp32_core.h`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h) vào thư mục `main/` hoặc `components/nxmodbus/` của dự án ESP-IDF và kết nối với driver UART RS485 như sau:

```c
#include "nxmodbus_esp32_core.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"

static const char *TAG = "NXMODBUS_ESP32";

/* Cấu hình phần cứng UART RS485 trên ESP32-S3 */
typedef struct {
    uart_port_t uart_num;
    uint32_t baudrate;
    SemaphoreHandle_t bus_mutex;
} esp32_rs485_port_t;

static esp32_rs485_port_t g_rs485_com1;

/**
 * 1. Khởi tạo cổng RS485 Half-Duplex trên ESP32 (tự động điều khiển chân DE/RE)
 */
void esp32_rs485_init(esp32_rs485_port_t *ctx, uart_port_t uart_num, int tx_pin, int rx_pin, int rts_de_pin, uint32_t baud) {
    ctx->uart_num = uart_num;
    ctx->baudrate = baud;
    ctx->bus_mutex = xSemaphoreCreateMutex();

    uart_config_t uart_config = {
        .baud_rate = (int)baud,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(uart_num, 512, 512, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(uart_num, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(uart_num, tx_pin, rx_pin, rts_de_pin, UART_PIN_NO_CHANGE));
    /* Chế độ RS485 Half-Duplex: ESP-IDF tự động kéo chân RTS (DE/RE) lên HIGH khi phát và về LOW khi thu */
    ESP_ERROR_CHECK(uart_set_mode(uart_num, UART_MODE_RS485_HALF_DUPLEX));
}

/**
 * 2. Hàm Callback truyền/nhận vật lý gắn vào `nxmb_execute_tab_poll()`
 */
static int esp32_rs485_transceive(
    void *user_ctx,
    const uint8_t *tx_buf,
    size_t tx_len,
    uint8_t *rx_buf,
    size_t rx_max_len,
    uint32_t timeout_ms
) {
    esp32_rs485_port_t *ctx = (esp32_rs485_port_t *)user_ctx;
    if (!ctx) return -1;

    /* Khóa Mutex cổng RS485 để không xung đột giữa Polling, Ghi Relay và TCP Gateway */
    if (xSemaphoreTake(ctx->bus_mutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
        return -1;
    }

    /* Xóa rác trong FIFO RX trước khi gửi lệnh mới */
    uart_flush_input(ctx->uart_num);

    /* Gửi khung lệnh Modbus RTU */
    uart_write_bytes(ctx->uart_num, (const char *)tx_buf, tx_len);
    uart_wait_tx_done(ctx->uart_num, pdMS_TO_TICKS(100));

    /* Đọc phản hồi: chờ gói đầu tiên theo `timeout_ms`, sau đó gom tiếp cho đến khi hết khung (silent interval 10ms) */
    int total_read = 0;
    int first_len = uart_read_bytes(ctx->uart_num, rx_buf, rx_max_len, pdMS_TO_TICKS(timeout_ms));
    if (first_len > 0) {
        total_read = first_len;
        while ((size_t)total_read < rx_max_len) {
            int more = uart_read_bytes(
                ctx->uart_num,
                rx_buf + total_read,
                rx_max_len - (size_t)total_read,
                pdMS_TO_TICKS(10)
            );
            if (more <= 0) break;
            total_read += more;
        }
    }

    /* Thời gian nghỉ bắt buộc giữa 2 khung truyền (Inter-frame Turnaround Delay) để chống nhiễu RS485 */
    uint32_t silent_ms = (ctx->baudrate <= 19200) ? 15 : 5;
    vTaskDelay(pdMS_TO_TICKS(silent_ms));

    xSemaphoreGive(ctx->bus_mutex);
    return total_read;
}

/**
 * 3. Ví dụ thực thi đọc 80 thanh ghi của Board V1 STM32G030 (tự động tách 5 khối né 34 ô cấm ở giữa)
 */
void example_poll_board_v1_task(void *arg) {
    nxmb_addr_mask_t disabled_mask;
    /* Khai báo dải địa chỉ cấm đọc giống hệt file JSON trên Router .12 */
    nxmb_parse_disabled_addrs_str(&disabled_mask, "19-31, 41-47, 56-63, 73-79");

    static nxmb_point_result_t results[80];
    nxmb_split_plan_t plan;

    while (1) {
        int ok_blocks = nxmb_execute_tab_poll(
            esp32_rs485_transceive,
            &g_rs485_com1,
            1,                  /* Slave ID = 1 */
            3,                  /* Function Code = 03 (Holding Registers) */
            0,                  /* Start Address = 0 */
            80,                 /* Tổng số thanh ghi = 80 */
            &disabled_mask,     /* Danh sách ô cấm đọc ở giữa */
            NXMB_FMT_UINT16,    /* Định dạng mặc định */
            NULL,               /* Hệ số scale (NULL = 1.0) */
            300,                /* Timeout = 300ms */
            true,               /* Tự động dò và khóa thêm nếu phát sinh lỗi 0x02 */
            results,
            &plan
        );

        ESP_LOGI(TAG, "Đã đọc %d/%u khối liên tiếp (Đọc: %u ô, Né: %u ô) | MCU_VDDA = %u mV | RL1 = %u",
                 ok_blocks, plan.block_count, plan.enabled_total, plan.skipped_total,
                 results[11].raw_word, results[33].raw_word);

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

/**
 * 4. Ví dụ điều khiển đóng/cắt Relay tức thời (FC06 - Write Single Register)
 */
bool esp32_write_single_register(uint8_t slave_id, uint16_t reg_addr, uint16_t value) {
    uint8_t tx_frame[8];
    uint8_t rx_frame[16];
    nxmb_build_write_single_request(slave_id, 6, reg_addr, value, tx_frame);
    int rx_len = esp32_rs485_transceive(&g_rs485_com1, tx_frame, 8, rx_frame, sizeof(rx_frame), 300);
    return (rx_len >= 8 && memcmp(tx_frame, rx_frame, 8) == 0);
}
```

---

## 4. Bảng Ánh Xạ REST API Để Dùng Lại Nguyên Bản Giao Diện Web (`router_app/web/`) Trên ESP32

Nếu bạn muốn nhúng nguyên bộ giao diện Web hiện tại ([`router_app/web/index.html`](file:///e:/00_Code/NXChieu-modbus-tool/router_app/web/index.html), [`app_core.js`](file:///e:/00_Code/NXChieu-modbus-tool/router_app/web/js/app_core.js), [`scanner_gateway_datalog.js`](file:///e:/00_Code/NXChieu-modbus-tool/router_app/web/js/scanner_gateway_datalog.js), [`profile_studio_and_builder.js`](file:///e:/00_Code/NXChieu-modbus-tool/router_app/web/js/profile_studio_and_builder.js)) vào `esp_http_server` của ESP32, chỉ cần cung cấp đúng 6 endpoint JSON cốt lõi sau:

| Endpoint | Phương thức | Đầu vào JSON (Request) | Đầu ra JSON (Response) |
|---|---|---|---|
| `/api/status` | `GET` | — | Trả về danh sách cổng `available_ports` (VD: `UART1`, `UART2`), `saved_polling_tabs`, `active_profile_name`, `saved_profiles`, dung lượng RAM (`esp_get_free_heap_size()`) và Thẻ nhớ SD. |
| `/api/poll` | `POST` | `{"port":"UART1", "baud":19200, "slave_id":1, "fn_code":3, "start_addr":0, "count":80, "disabled_addrs":"19-31, 41-47", "format":"uint16"}` | Gọi [`nxmb_execute_tab_poll()`](file:///e:/00_Code/NXChieu-modbus-tool/esp32_port/nxmodbus_esp32_core.h#L510-L619) và trả về `{"status":"ok", "latency_ms":42, "sub_blocks_total":5, "skipped_count":34, "data":[...], "raw_words":[...], "point_states":["ok",...,"skipped"]}`. |
| `/api/poll/auto_mask` | `POST` | Giống `/api/poll` | Gọi `nxmb_execute_tab_poll(..., auto_mask_on_0x02 = true)` rồi xuất chuỗi `nxmb_format_disabled_addrs_str()` trả về trường `"disabled_addrs_str"`. |
| `/api/write` | `POST` | `{"port":"UART1", "slave_id":1, "fn_code":6, "addr":33, "value":1}` | Gọi `nxmb_build_write_single_request()` hoặc `nxmb_build_write_multiple_registers()` và trả về `{"status":"ok", "tx_hex":"...", "rx_hex":"..."}`. |
| `/api/profile/list` & `/api/profile/load` | `GET` / `POST` | `{"file":"Board_V1.json"}` | Đọc/ghi trực tiếp các file `.json` trong thư mục `/sdcard/modbus_data/profiles/` trên thẻ nhớ MicroSD hoặc phân vùng LittleFS của ESP32. |
| `/api/scan` | `POST` | `{"port":"UART1", "baud":19200, "start_id":1, "end_id":30, "reg_addr":0}` | Lặp qua `slave_id = start_id..end_id`, gọi `nxmb_build_read_request(id, 3, reg_addr, 1)` với `timeout_ms = 60ms` để phát hiện nhanh các thiết bị đang online trên bus. |
