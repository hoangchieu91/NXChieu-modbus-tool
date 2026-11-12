/**
 * ============================================================================
 * NXChieu Modbus Studio Pro v3.3 — Core Business Logic for ESP32 (ESP-IDF / Arduino)
 * File: esp32_port/nxmodbus_esp32_core.h
 *
 * Tính năng cốt lõi (100% tương thích với chuẩn JSON "nxmodbus-monitor-v3.3"):
 *   1. Thuật toán Tách Khối Liên Tiếp Thông Minh (Smart Contiguous Sub-Block Splitting):
 *      - Phân tích chuỗi/mảng `disabled_addrs` (VD: "3-5, 8-10, 12")
 *      - Tự động băm dải đọc `start_addr..start_addr+count` (tối đa 250 thanh ghi)
 *        thành các khối lệnh Modbus FC01/02/03/04 liên tiếp hợp lệ (`max_chunk = 120`),
 *        tuyệt đối không gửi lệnh chạm vào ô nhớ cấm (tránh lỗi Exception 0x02).
 *   2. Tự động dò và khóa ô nhớ lỗi 0x02 (Auto-Masking Illegal Data Address).
 *   3. Bộ mã hóa/giải mã khung truyền Modbus RTU (CRC16-IBM, FC01..06, FC15, FC16)
 *      kèm giải mã đa định dạng (uint16, int16, uint32/int32/float32 4 kiểu Endian:
 *      ABCD, DCBA, BADC, CDAB) và nhân hệ số `scale`.
 *   4. Quản lý Khóa Bus RS485 đa luồng (FreeRTOS Per-UART Mutex + Quản lý chân DE/RE
 *      + Thời gian nghỉ chống nhiễu giữa 2 khung truyền `inter_frame_delay_ms`).
 * ============================================================================
 */

#ifndef NXMODBUS_ESP32_CORE_H
#define NXMODBUS_ESP32_CORE_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#ifdef ESP_PLATFORM
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * 1. HẰNG SỐ & CẤU TRÚC DỮ LIỆU CỐT LÕI
 * ============================================================================ */

#define NXMB_MAX_COUNT_PER_TAB      250   /* Số thanh ghi tối đa trên 1 Tab Poll */
#define NXMB_MAX_MODBUS_CHUNK       120   /* Số thanh ghi tối đa mỗi lệnh FC03/FC04 */
#define NXMB_MAX_SUB_BLOCKS         64    /* Số khối con tối đa sau khi băm né ô cấm */
#define NXMB_BITMAP_WORDS           2048  /* 2048 * 32 = 65536 bit cho địa chỉ 0..65535 */

/**
 * Định dạng giải mã dữ liệu thanh ghi (khớp 1:1 với Web Studio & Desktop App)
 */
typedef enum {
    NXMB_FMT_UINT16 = 0,
    NXMB_FMT_INT16,
    NXMB_FMT_HEX,
    NXMB_FMT_BIN,
    NXMB_FMT_UINT32_BE,     /* ABCD (Big-Endian chuẩn) */
    NXMB_FMT_UINT32_WS,     /* BADC (Word-Swapped / Mid-Little) */
    NXMB_FMT_UINT32_LE,     /* DCBA (Little-Endian) */
    NXMB_FMT_UINT32_BS,     /* CDAB (Byte-Swapped) */
    NXMB_FMT_INT32_BE,      /* ABCD */
    NXMB_FMT_INT32_WS,      /* BADC */
    NXMB_FMT_FLOAT32_BE,    /* ABCD (IEEE 754 Big-Endian) */
    NXMB_FMT_FLOAT32_WS,    /* BADC (IEEE 754 Word-Swapped - rất phổ biến trên đồng hồ điện) */
    NXMB_FMT_FLOAT32_LE,    /* DCBA */
    NXMB_FMT_FLOAT32_BS     /* CDAB */
} nxmb_format_t;

/**
 * Cấu trúc 1 khối lệnh con liên tiếp (Contiguous Sub-Block)
 */
typedef struct {
    uint16_t start_addr;    /* Địa chỉ thanh ghi bắt đầu của khối con */
    uint16_t count;         /* Số lượng thanh ghi đọc liên tiếp trong khối con */
    uint16_t offset;        /* Vị trí tương đối so với start_addr gốc của Tab (0..count-1) */
} nxmb_sub_block_t;

/**
 * Kết quả tách khối thông minh (Smart Sub-Block Plan)
 */
typedef struct {
    nxmb_sub_block_t blocks[NXMB_MAX_SUB_BLOCKS];
    uint16_t block_count;       /* Số lượng lệnh Modbus RTU thực tế cần gửi */
    uint16_t enabled_total;     /* Tổng số thanh ghi được phép đọc */
    uint16_t skipped_total;     /* Tổng số thanh ghi bị cấm đọc (né lỗi 0x02) */
} nxmb_split_plan_t;

/**
 * Trạng thái từng điểm dữ liệu sau khi đọc (Point State)
 */
typedef enum {
    NXMB_PT_OK = 0,         /* Đọc thành công */
    NXMB_PT_SKIPPED = 1,    /* Đã chủ động bỏ qua (nằm trong disabled_addrs) */
    NXMB_PT_ERROR = 2       /* Lỗi truyền thông hoặc Exception từ Slave */
} nxmb_point_status_t;

typedef struct {
    uint16_t addr;              /* Địa chỉ thanh ghi (0-based) */
    uint16_t raw_word;          /* Giá trị 16-bit thô (0x0000..0xFFFF) */
    double scaled_val;          /* Giá trị sau khi giải mã & nhân hệ số scale */
    nxmb_point_status_t status; /* OK / SKIPPED / ERROR */
    uint8_t exc_code;           /* Mã lỗi Modbus Exception nếu có (0x01, 0x02, 0x03...) */
} nxmb_point_result_t;


/* ============================================================================
 * 2. BỘ QUẢN LÝ BITMAP ĐỊA CHỈ CẤM ĐỌC (DISABLED ADDRESS SET)
 *    Tối ưu RAM cho ESP32: Thay vì dùng Hash Set tốn RAM như Python,
 *    dùng mảng bit hoặc danh sách khoảng (Range List) chỉ tốn vài chục byte!
 * ============================================================================ */

#define NXMB_MAX_RANGES 32

typedef struct {
    uint16_t from_addr;
    uint16_t to_addr;
} nxmb_addr_range_t;

typedef struct {
    nxmb_addr_range_t ranges[NXMB_MAX_RANGES];
    uint8_t range_count;
} nxmb_addr_mask_t;

static inline void nxmb_mask_init(nxmb_addr_mask_t *mask) {
    if (mask) {
        mask->range_count = 0;
    }
}

static inline void nxmb_mask_add_range(nxmb_addr_mask_t *mask, uint16_t a, uint16_t b) {
    if (!mask) return;
    uint16_t lo = (a <= b) ? a : b;
    uint16_t hi = (a <= b) ? b : a;

    /* Gộp vào dải hiện có nếu chồng lấn hoặc kề nhau */
    for (uint8_t i = 0; i < mask->range_count; i++) {
        if (hi + 1 >= mask->ranges[i].from_addr && lo <= mask->ranges[i].to_addr + 1) {
            if (lo < mask->ranges[i].from_addr) mask->ranges[i].from_addr = lo;
            if (hi > mask->ranges[i].to_addr)   mask->ranges[i].to_addr = hi;
            return;
        }
    }
    if (mask->range_count < NXMB_MAX_RANGES) {
        mask->ranges[mask->range_count].from_addr = lo;
        mask->ranges[mask->range_count].to_addr = hi;
        mask->range_count++;
    }
}

static inline bool nxmb_mask_contains(const nxmb_addr_mask_t *mask, uint16_t addr) {
    if (!mask) return false;
    for (uint8_t i = 0; i < mask->range_count; i++) {
        if (addr >= mask->ranges[i].from_addr && addr <= mask->ranges[i].to_addr) {
            return true;
        }
    }
    return false;
}

/**
 * Phân tích chuỗi `disabled_addrs` chuẩn "nxmodbus-monitor-v3.3"
 * Ví dụ đầu vào: "3-5, 8-10, 12, 17..18"
 */
static inline void nxmb_parse_disabled_addrs_str(nxmb_addr_mask_t *mask, const char *spec_str) {
    nxmb_mask_init(mask);
    if (!spec_str || !*spec_str) return;

    const char *p = spec_str;
    while (*p) {
        while (*p == ' ' || *p == ',' || *p == ';' || *p == '\t' || *p == '\n' || *p == '[' || *p == ']') p++;
        if (!*p) break;

        char *end1 = NULL;
        long v1 = strtol(p, &end1, 0);
        if (end1 == p) {
            p++;
            continue;
        }
        p = end1;
        while (*p == ' ') p++;

        if (*p == '-' || *p == ':' || (*p == '.' && *(p + 1) == '.')) {
            if (*p == '.') p += 2;
            else p += 1;
            while (*p == ' ') p++;
            char *end2 = NULL;
            long v2 = strtol(p, &end2, 0);
            if (end2 != p) {
                p = end2;
                if (v1 >= 0 && v1 <= 65535 && v2 >= 0 && v2 <= 65535) {
                    nxmb_mask_add_range(mask, (uint16_t)v1, (uint16_t)v2);
                }
                continue;
            }
        }

        if (v1 >= 0 && v1 <= 65535) {
            nxmb_mask_add_range(mask, (uint16_t)v1, (uint16_t)v1);
        }
    }
}

/**
 * Xuất ngược `nxmb_addr_mask_t` ra chuỗi gọn "3-5, 8-10, 12" để lưu JSON lên Thẻ nhớ SD
 */
static inline size_t nxmb_format_disabled_addrs_str(const nxmb_addr_mask_t *mask, char *out_buf, size_t buf_size) {
    if (!out_buf || buf_size == 0) return 0;
    out_buf[0] = '\0';
    if (!mask || mask->range_count == 0) return 0;

    size_t pos = 0;
    for (uint8_t i = 0; i < mask->range_count; i++) {
        uint16_t lo = mask->ranges[i].from_addr;
        uint16_t hi = mask->ranges[i].to_addr;
        int n = 0;
        if (lo == hi) {
            n = snprintf(out_buf + pos, buf_size - pos, "%s%u", (i > 0) ? ", " : "", lo);
        } else {
            n = snprintf(out_buf + pos, buf_size - pos, "%s%u-%u", (i > 0) ? ", " : "", lo, hi);
        }
        if (n < 0 || (size_t)n >= buf_size - pos) break;
        pos += (size_t)n;
    }
    return pos;
}


/* ============================================================================
 * 3. THUẬT TOÁN TÁCH KHỐI LIÊN TIẾP THÔNG MINH (SMART CONTIGUOUS SUB-BLOCK SPLITTING)
 *    Tương đương 100% với `build_safe_sub_blocks()` trong `sd_profile_manager.py`
 *    và `BuildSubBlocks()` trong `pkg/modbus/models.go`.
 * ============================================================================ */

static inline void nxmb_build_safe_sub_blocks(
    uint16_t start_addr,
    uint16_t count,
    const nxmb_addr_mask_t *disabled_mask,
    uint16_t max_chunk,
    nxmb_split_plan_t *out_plan
) {
    if (!out_plan) return;
    memset(out_plan, 0, sizeof(*out_plan));

    if (count == 0) return;
    if (count > NXMB_MAX_COUNT_PER_TAB) count = NXMB_MAX_COUNT_PER_TAB;
    if (max_chunk == 0 || max_chunk > NXMB_MAX_MODBUS_CHUNK) max_chunk = NXMB_MAX_MODBUS_CHUNK;

    bool in_block = false;
    uint16_t cur_start = 0;
    uint16_t cur_off = 0;
    uint16_t cur_len = 0;

    for (uint16_t i = 0; i < count; i++) {
        uint16_t addr = (uint16_t)(start_addr + i);
        bool is_disabled = nxmb_mask_contains(disabled_mask, addr);

        if (is_disabled) {
            out_plan->skipped_total++;
            if (in_block && out_plan->block_count < NXMB_MAX_SUB_BLOCKS) {
                out_plan->blocks[out_plan->block_count].start_addr = cur_start;
                out_plan->blocks[out_plan->block_count].count = cur_len;
                out_plan->blocks[out_plan->block_count].offset = cur_off;
                out_plan->block_count++;
                in_block = false;
                cur_len = 0;
            }
        } else {
            out_plan->enabled_total++;
            if (!in_block) {
                in_block = true;
                cur_start = addr;
                cur_off = i;
                cur_len = 1;
            } else {
                cur_len++;
                if (cur_len >= max_chunk && out_plan->block_count < NXMB_MAX_SUB_BLOCKS) {
                    out_plan->blocks[out_plan->block_count].start_addr = cur_start;
                    out_plan->blocks[out_plan->block_count].count = cur_len;
                    out_plan->blocks[out_plan->block_count].offset = cur_off;
                    out_plan->block_count++;
                    in_block = false;
                    cur_len = 0;
                }
            }
        }
    }

    if (in_block && cur_len > 0 && out_plan->block_count < NXMB_MAX_SUB_BLOCKS) {
        out_plan->blocks[out_plan->block_count].start_addr = cur_start;
        out_plan->blocks[out_plan->block_count].count = cur_len;
        out_plan->blocks[out_plan->block_count].offset = cur_off;
        out_plan->block_count++;
    }
}


/* ============================================================================
 * 4. MODBUS RTU CRC16 & BỘ ĐÓNG GÓI / GIẢI MÃ KHUNG TRUYỀN (FRAME ENGINE)
 * ============================================================================ */

static inline uint16_t nxmb_crc16(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i];
        for (uint8_t b = 0; b < 8; b++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc;
}

/**
 * Tạo gói tin đọc Modbus RTU (FC01, FC02, FC03, FC04) — Độ dài luôn là 8 bytes
 */
static inline size_t nxmb_build_read_request(
    uint8_t slave_id,
    uint8_t fn_code,
    uint16_t start_addr,
    uint16_t count,
    uint8_t out_frame[8]
) {
    out_frame[0] = slave_id;
    out_frame[1] = fn_code;
    out_frame[2] = (uint8_t)((start_addr >> 8) & 0xFF);
    out_frame[3] = (uint8_t)(start_addr & 0xFF);
    out_frame[4] = (uint8_t)((count >> 8) & 0xFF);
    out_frame[5] = (uint8_t)(count & 0xFF);
    uint16_t crc = nxmb_crc16(out_frame, 6);
    out_frame[6] = (uint8_t)(crc & 0xFF);
    out_frame[7] = (uint8_t)((crc >> 8) & 0xFF);
    return 8;
}

/**
 * Tạo gói tin ghi 1 thanh ghi / 1 Coil (FC05 hoặc FC06) — Độ dài 8 bytes
 * Lưu ý: Với FC05 (Write Single Coil), `val != 0` tự động chuyển thành `0xFF00`.
 */
static inline size_t nxmb_build_write_single_request(
    uint8_t slave_id,
    uint8_t fn_code,
    uint16_t reg_addr,
    uint16_t val,
    uint8_t out_frame[8]
) {
    uint16_t wire_val = (fn_code == 5) ? (val ? 0xFF00 : 0x0000) : val;
    out_frame[0] = slave_id;
    out_frame[1] = fn_code;
    out_frame[2] = (uint8_t)((reg_addr >> 8) & 0xFF);
    out_frame[3] = (uint8_t)(reg_addr & 0xFF);
    out_frame[4] = (uint8_t)((wire_val >> 8) & 0xFF);
    out_frame[5] = (uint8_t)(wire_val & 0xFF);
    uint16_t crc = nxmb_crc16(out_frame, 6);
    out_frame[6] = (uint8_t)(crc & 0xFF);
    out_frame[7] = (uint8_t)((crc >> 8) & 0xFF);
    return 8;
}

/**
 * Tạo gói tin ghi nhiều thanh ghi (FC16 - 0x10)
 */
static inline size_t nxmb_build_write_multiple_registers(
    uint8_t slave_id,
    uint16_t start_addr,
    const uint16_t *values,
    uint16_t reg_count,
    uint8_t *out_frame,
    size_t max_frame_len
) {
    size_t byte_count = (size_t)reg_count * 2;
    size_t total_len = 7 + byte_count + 2;
    if (!out_frame || !values || reg_count == 0 || total_len > max_frame_len) return 0;

    out_frame[0] = slave_id;
    out_frame[1] = 16; /* FC16 */
    out_frame[2] = (uint8_t)((start_addr >> 8) & 0xFF);
    out_frame[3] = (uint8_t)(start_addr & 0xFF);
    out_frame[4] = (uint8_t)((reg_count >> 8) & 0xFF);
    out_frame[5] = (uint8_t)(reg_count & 0xFF);
    out_frame[6] = (uint8_t)byte_count;

    for (uint16_t i = 0; i < reg_count; i++) {
        out_frame[7 + i * 2]     = (uint8_t)((values[i] >> 8) & 0xFF);
        out_frame[7 + i * 2 + 1] = (uint8_t)(values[i] & 0xFF);
    }

    uint16_t crc = nxmb_crc16(out_frame, 7 + byte_count);
    out_frame[7 + byte_count]     = (uint8_t)(crc & 0xFF);
    out_frame[7 + byte_count + 1] = (uint8_t)((crc >> 8) & 0xFF);
    return total_len;
}

/**
 * Kiểm tra và bóc tách gói phản hồi đọc (FC01/02/03/04) sang mảng `uint16_t out_words[]`
 * Trả về:
 *   0  : Thành công (`out_words` chứa `expected_count` phần tử)
 *  >0  : Mã lỗi Modbus Exception từ thiết bị (VD: 0x01, 0x02, 0x03, 0x04)
 *  -1  : Khung truyền quá ngắn / Timeout
 *  -2  : Sai CRC16
 *  -3  : Sai Slave ID hoặc lệch độ dài ByteCount
 */
static inline int nxmb_parse_read_response(
    const uint8_t *rx_buf,
    size_t rx_len,
    uint8_t expected_slave,
    uint8_t expected_fn,
    uint16_t expected_count,
    uint16_t *out_words
) {
    if (!rx_buf || rx_len < 5) return -1;

    /* Kiểm tra CRC16 */
    uint16_t calc_crc = nxmb_crc16(rx_buf, rx_len - 2);
    uint16_t recv_crc = (uint16_t)rx_buf[rx_len - 2] | ((uint16_t)rx_buf[rx_len - 1] << 8);
    if (calc_crc != recv_crc) return -2;

    if (rx_buf[0] != expected_slave) return -3;

    /* Kiểm tra khung báo lỗi Modbus Exception (Function Code có bit 0x80 bật) */
    if (rx_buf[1] == (uint8_t)(expected_fn | 0x80)) {
        return (int)rx_buf[2]; /* Trả về mã Exception: 0x01..0x0B */
    }
    if (rx_buf[1] != expected_fn) return -3;

    uint8_t byte_count = rx_buf[2];
    if (rx_len < (size_t)(3 + byte_count + 2)) return -3;

    if (expected_fn == 3 || expected_fn == 4) {
        if (byte_count < expected_count * 2) return -3;
        for (uint16_t i = 0; i < expected_count; i++) {
            out_words[i] = ((uint16_t)rx_buf[3 + i * 2] << 8) | (uint16_t)rx_buf[3 + i * 2 + 1];
        }
    } else if (expected_fn == 1 || expected_fn == 2) {
        /* Giải nén từng bit cho FC01 (Coils) / FC02 (Discrete Inputs) */
        for (uint16_t i = 0; i < expected_count; i++) {
            uint8_t b = rx_buf[3 + (i / 8)];
            out_words[i] = (b >> (i % 8)) & 0x01;
        }
    }
    return 0;
}


/* ============================================================================
 * 5. GIẢI MÃ ĐA ĐỊNH DẠNG 16-BIT / 32-BIT & HỆ SỐ SCALE
 * ============================================================================ */

static inline uint32_t nxmb_combine_32bit(uint16_t w0, uint16_t w1, nxmb_format_t fmt) {
    uint8_t a = (uint8_t)((w0 >> 8) & 0xFF);
    uint8_t b = (uint8_t)(w0 & 0xFF);
    uint8_t c = (uint8_t)((w1 >> 8) & 0xFF);
    uint8_t d = (uint8_t)(w1 & 0xFF);

    switch (fmt) {
        case NXMB_FMT_UINT32_WS:
        case NXMB_FMT_INT32_WS:
        case NXMB_FMT_FLOAT32_WS:
            /* Word-Swapped (CDAB / Low-word first) */
            return ((uint32_t)w1 << 16) | (uint32_t)w0;

        case NXMB_FMT_UINT32_LE:
        case NXMB_FMT_FLOAT32_LE:
            /* Little-Endian (DCBA) */
            return ((uint32_t)d << 24) | ((uint32_t)c << 16) | ((uint32_t)b << 8) | (uint32_t)a;

        case NXMB_FMT_UINT32_BS:
        case NXMB_FMT_FLOAT32_BS:
            /* Byte-Swapped within words (BADC) */
            return ((uint32_t)b << 24) | ((uint32_t)a << 16) | ((uint32_t)d << 8) | (uint32_t)c;

        default:
            /* Big-Endian chuẩn (ABCD) */
            return ((uint32_t)w0 << 16) | (uint32_t)w1;
    }
}

static inline double nxmb_decode_value(
    const uint16_t *words,
    uint16_t index,
    uint16_t total_count,
    nxmb_format_t fmt,
    double scale
) {
    if (!words || index >= total_count) return 0.0;
    if (scale == 0.0) scale = 1.0;

    uint16_t w0 = words[index];
    uint16_t w1 = (index + 1 < total_count) ? words[index + 1] : 0;

    switch (fmt) {
        case NXMB_FMT_INT16:
            return (double)((int16_t)w0) * scale;

        case NXMB_FMT_UINT32_BE:
        case NXMB_FMT_UINT32_WS:
        case NXMB_FMT_UINT32_LE:
        case NXMB_FMT_UINT32_BS: {
            uint32_t u32 = nxmb_combine_32bit(w0, w1, fmt);
            return (double)u32 * scale;
        }

        case NXMB_FMT_INT32_BE:
        case NXMB_FMT_INT32_WS: {
            int32_t i32 = (int32_t)nxmb_combine_32bit(w0, w1, fmt);
            return (double)i32 * scale;
        }

        case NXMB_FMT_FLOAT32_BE:
        case NXMB_FMT_FLOAT32_WS:
        case NXMB_FMT_FLOAT32_LE:
        case NXMB_FMT_FLOAT32_BS: {
            union {
                uint32_t u;
                float f;
            } conv;
            conv.u = nxmb_combine_32bit(w0, w1, fmt);
            return (double)conv.f * scale;
        }

        case NXMB_FMT_UINT16:
        case NXMB_FMT_HEX:
        case NXMB_FMT_BIN:
        default:
            return (double)w0 * scale;
    }
}


/* ============================================================================
 * 6. NHẬN DIỆN THÔNG MINH KIỂU ĐIỀU KHIỂN TỪ TÊN TAG (SEMANTIC TAG INFERENCE)
 *    Khớp với `isTagAutoReadOnly()` và `inferControlFromTagAndFn()` trên Web UI
 * ============================================================================ */

typedef enum {
    NXMB_CTRL_READ_ONLY = 0,    /* Chỉ đọc (Cảm biến, DI, Điện áp, Dòng điện, UID...) */
    NXMB_CTRL_TOGGLE_01,        /* Nút BẬT (1) / TẮT (0) cho Relay, DO, Coil */
    NXMB_CTRL_COUNTER_RESET,    /* Nút Reset bộ đếm xung về 0 (DI_COUNT) */
    NXMB_CTRL_PULSE_TIMER,      /* Nút kích xung nhịp (0.5s / 1s / 3s) */
    NXMB_CTRL_STEPPER           /* Ô nhập số kèm nút [-] [+] */
} nxmb_control_mode_t;

static inline nxmb_control_mode_t nxmb_infer_control_mode(uint8_t fn_code, const char *tag_name) {
    if (fn_code == 2 || fn_code == 4) return NXMB_CTRL_READ_ONLY;
    if (fn_code == 1) return NXMB_CTRL_TOGGLE_01;
    if (!tag_name || !*tag_name) return NXMB_CTRL_STEPPER;

    /* Kiểm tra bộ đếm xung DI_COUNT -> Cho phép Reset về 0 */
    if (strstr(tag_name, "COUNT") || strstr(tag_name, "CNT")) {
        return NXMB_CTRL_COUNTER_RESET;
    }
    /* Kiểm tra thanh ghi kích xung nhịp PULSE */
    if (strstr(tag_name, "PULSE") || strstr(tag_name, "CYCLE")) {
        return NXMB_CTRL_PULSE_TIMER;
    }
    /* Kiểm tra các thanh ghi trạng thái / cảm biến chỉ đọc */
    if (strstr(tag_name, "DI1_STATE") || strstr(tag_name, "DI2_STATE") ||
        strstr(tag_name, "DI3_STATE") || strstr(tag_name, "DI4_STATE") ||
        strstr(tag_name, "DIP_STATE") || strstr(tag_name, "DI_BITMAP") ||
        strstr(tag_name, "DO_BITMAP") || strstr(tag_name, "TEMP") ||
        strstr(tag_name, "VOLT")      || strstr(tag_name, "RAW_ADC") ||
        strstr(tag_name, "VDDA")      || strstr(tag_name, "UID_") ||
        strstr(tag_name, "UPTIME")    || strstr(tag_name, "CRC_ERR") ||
        strstr(tag_name, "FRAME_CNT") || strstr(tag_name, "EXC_CNT") ||
        strstr(tag_name, "FW_VERSION")) {
        return NXMB_CTRL_READ_ONLY;
    }
    /* Kiểm tra Relay / Ngõ ra 12V / Coil ON-OFF */
    if (strstr(tag_name, "RL") || strstr(tag_name, "RELAY") ||
        strstr(tag_name, "OUT12V") || strstr(tag_name, "DO") ||
        strstr(tag_name, "0=OFF")) {
        return NXMB_CTRL_TOGGLE_01;
    }
    return NXMB_CTRL_STEPPER;
}


/* ============================================================================
 * 7. TRÌNH ĐIỀU PHỐI POLLING TÁCH KHỐI & AUTO-MASK TRÊN ESP32 (ESP-IDF / FREERTOS)
 * ============================================================================ */

/**
 * Callback giao tiếp vật lý RS485 (cho phép gắn bất kỳ UART nào của ESP32 hoặc WCH CH348)
 * Trả về số byte đọc được vào `rx_buf`, hoặc <= 0 nếu timeout.
 */
typedef int (*nxmb_transceive_fn_t)(
    void *user_ctx,
    const uint8_t *tx_buf,
    size_t tx_len,
    uint8_t *rx_buf,
    size_t rx_max_len,
    uint32_t timeout_ms
);

/**
 * Thực thi 1 chu kỳ đọc Tab với thuật toán Smart Sub-Block Splitting:
 * - Tự động bỏ qua các địa chỉ trong `disabled_mask`
 * - Chỉ gửi các khối lệnh liên tiếp hợp lệ
 * - Nếu `auto_mask_on_0x02 == true` và gặp lỗi Exception `0x02` ở một khối con,
 *   tự động dò từng thanh ghi trong khối con đó để tìm chính xác địa chỉ gây lỗi `0x02`
 *   và thêm ngay vào `disabled_mask` cho các chu kỳ sau!
 */
static inline int nxmb_execute_tab_poll(
    nxmb_transceive_fn_t transceive_cb,
    void *user_ctx,
    uint8_t slave_id,
    uint8_t fn_code,
    uint16_t start_addr,
    uint16_t count,
    nxmb_addr_mask_t *disabled_mask,
    nxmb_format_t fmt,
    const double *scales_opt,
    uint32_t timeout_ms,
    bool auto_mask_on_0x02,
    nxmb_point_result_t *out_points,
    nxmb_split_plan_t *out_plan_opt
) {
    if (!transceive_cb || !out_points || count == 0) return -1;
    if (count > NXMB_MAX_COUNT_PER_TAB) count = NXMB_MAX_COUNT_PER_TAB;

    /* 1. Khởi tạo trạng thái mặc định cho toàn bộ `count` thanh ghi */
    for (uint16_t i = 0; i < count; i++) {
        out_points[i].addr = (uint16_t)(start_addr + i);
        out_points[i].raw_word = 0;
        out_points[i].scaled_val = 0.0;
        out_points[i].status = NXMB_PT_SKIPPED;
        out_points[i].exc_code = 0;
    }

    /* 2. Tính toán sơ đồ tách khối liên tiếp (Smart Sub-Blocks) */
    nxmb_split_plan_t plan;
    nxmb_build_safe_sub_blocks(start_addr, count, disabled_mask, NXMB_MAX_MODBUS_CHUNK, &plan);
    if (out_plan_opt) {
        *out_plan_opt = plan;
    }
    if (plan.block_count == 0) {
        return 0; /* Tất cả các ô đều đang bị đánh dấu skip */
    }

    uint8_t tx_frame[8];
    uint8_t rx_frame[260];
    uint16_t block_words[NXMB_MAX_MODBUS_CHUNK];
    uint16_t all_words[NXMB_MAX_COUNT_PER_TAB];
    memset(all_words, 0, sizeof(all_words));

    int success_blocks = 0;

    /* 3. Lần lượt đọc từng khối con liên tiếp */
    for (uint16_t b = 0; b < plan.block_count; b++) {
        uint16_t b_start = plan.blocks[b].start_addr;
        uint16_t b_count = plan.blocks[b].count;
        uint16_t b_off   = plan.blocks[b].offset;

        nxmb_build_read_request(slave_id, fn_code, b_start, b_count, tx_frame);
        int rx_len = transceive_cb(user_ctx, tx_frame, 8, rx_frame, sizeof(rx_frame), timeout_ms);

        int parse_res = -1;
        if (rx_len > 0) {
            parse_res = nxmb_parse_read_response(rx_frame, (size_t)rx_len, slave_id, fn_code, b_count, block_words);
        }

        if (parse_res == 0) {
            /* Khối con đọc thành công */
            success_blocks++;
            for (uint16_t k = 0; k < b_count; k++) {
                uint16_t idx = (uint16_t)(b_off + k);
                all_words[idx] = block_words[k];
                out_points[idx].raw_word = block_words[k];
                out_points[idx].status = NXMB_PT_OK;
                out_points[idx].exc_code = 0;
            }
        } else if (parse_res == 0x02 && auto_mask_on_0x02 && b_count > 1 && disabled_mask != NULL) {
            /*
             * Tự động dò từng thanh ghi khi gặp Exception 0x02 (Illegal Data Address):
             * Đọc lẻ từng thanh ghi trong khối để lấy dữ liệu các ô sống và khóa vĩnh viễn ô chết!
             */
            for (uint16_t k = 0; k < b_count; k++) {
                uint16_t single_addr = (uint16_t)(b_start + k);
                uint16_t idx = (uint16_t)(b_off + k);
                uint16_t single_word = 0;

                nxmb_build_read_request(slave_id, fn_code, single_addr, 1, tx_frame);
                int s_len = transceive_cb(user_ctx, tx_frame, 8, rx_frame, sizeof(rx_frame), timeout_ms);
                int s_res = (s_len > 0) ? nxmb_parse_read_response(rx_frame, (size_t)s_len, slave_id, fn_code, 1, &single_word) : -1;

                if (s_res == 0) {
                    all_words[idx] = single_word;
                    out_points[idx].raw_word = single_word;
                    out_points[idx].status = NXMB_PT_OK;
                    success_blocks++;
                } else if (s_res == 0x02) {
                    /* Phát hiện chính xác thanh ghi cấm đọc -> Thêm vào disabled_mask */
                    nxmb_mask_add_range(disabled_mask, single_addr, single_addr);
                    out_points[idx].status = NXMB_PT_SKIPPED;
                    out_points[idx].exc_code = 0x02;
                } else {
                    out_points[idx].status = NXMB_PT_ERROR;
                    out_points[idx].exc_code = (s_res > 0) ? (uint8_t)s_res : 0xFF;
                }
            }
        } else {
            /* Khối con bị lỗi timeout hoặc Exception khác */
            for (uint16_t k = 0; k < b_count; k++) {
                uint16_t idx = (uint16_t)(b_off + k);
                out_points[idx].status = NXMB_PT_ERROR;
                out_points[idx].exc_code = (parse_res > 0) ? (uint8_t)parse_res : 0xFF;
            }
        }
    }

    /* 4. Giải mã giá trị theo định dạng (`fmt`) và nhân hệ số `scale` */
    for (uint16_t i = 0; i < count; i++) {
        if (out_points[i].status == NXMB_PT_OK) {
            double sc = (scales_opt != NULL) ? scales_opt[i] : 1.0;
            out_points[i].scaled_val = nxmb_decode_value(all_words, i, count, fmt, sc);
        }
    }

    return success_blocks;
}

#ifdef __cplusplus
}
#endif

#endif /* NXMODBUS_ESP32_CORE_H */
