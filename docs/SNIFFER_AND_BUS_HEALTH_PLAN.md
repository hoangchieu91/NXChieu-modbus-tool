# Kế hoạch phát triển Modbus Sniffer và Bus Health Analyzer

> Tài liệu định hướng dùng chung cho các lập trình viên và coding agent (Codex, Claude,
> Antigravity...). Hãy đọc tài liệu này trước khi thiết kế hoặc triển khai tính năng sniffer.
>
> Hướng dẫn vận hành cho người dùng nằm tại `docs/SNIFFER_USER_GUIDE.md`.

## Trạng thái triển khai (cập nhật 2026-09-29)

Đã có vertical slice hoàn chỉnh của Phase 0, Phase 1, Phase 2, Phase 3 và Phase 4:

- `pkg/sniffer` chứa schema, decoder RTU/TCP, request-response correlation, bounded ring
  buffer, timeout và health snapshot.
- Decoder hỗ trợ đầy đủ FC01–06, FC07 (Read Exception Status), FC08 (Diagnostics), FC15,
  FC16, FC17 (Report Server ID), FC22 (Mask Write Register), FC23 (Read/Write Multiple Registers),
  FC43/14 (Read Device Identification), exception response, kiểm tra CRC RTU và MBAP TCP.
- Internal Master capture đã đưa `RawTx`/`RawRx` vào pipeline với nhãn
  `capture_quality=reconstructed`; Slave activity dùng `wire` khi có raw frame.
- Đã có chế độ Baseline Learn & Monitor: học chu kỳ poll median, P50/P95 latency, function code
  chuẩn của từng Unit ID; phát hiện bất thường `RTU_POLL_PERIOD_DRIFT`, `MODBUS_SLOW_RESPONSE`,
  `BASELINE_NEW_DEVICE`, `BASELINE_UNEXPECTED_FC`.
- Wails đã có API `GetSnifferSnapshot`, `ClearSniffer`, `SetSnifferBaselineMode`, `GetSnifferBaseline`,
  `ResetSnifferBaseline`.
- Giao diện `Protocol Analyzer` có bus health, baseline monitor badge & toggle, danh sách thiết bị
  kèm chỉ số baseline, frame table, bộ lọc, raw hex, decoded fields chi tiết cho FC mở rộng và diagnostics.
- Đã có Modbus TCP proxy và RTU-over-TCP proxy chuyển tiếp nguyên byte hai chiều, hỗ trợ
  nhiều kết nối, stream framing và lifecycle start/stop.
- Đã có Passive Serial RTU qua COM riêng, gap framing, CRC resynchronization và suy luận chiều.
- Đã có chế độ xem transaction, lưu/mở `.nxcap` có schema version và xuất báo cáo CSV.
- Diagnostics đã nhận biết timeout, orphan response, retry, slow response, exception, lệnh ghi,
  CRC/MBAP sai, poll period drift, unexpected FC, new device; device state có `not_polled` và `offline`.
- Đã có unit test và golden test đầy đủ cho decode mở rộng, baseline learn/monitor, correlation,
  latency, timeout, CRC và giới hạn ring buffer (100% PASS).
- Đã có integration test xác nhận TCP proxy không sửa byte và capture đủ hai chiều.

Các phần còn phụ thuộc hoặc cần phát triển tiếp: passive TCP/Npcap (cần driver Npcap trên máy),
device/register profile file, PCAPNG và báo cáo theo ca.
Các phần này không chặn việc dùng proxy hoặc adapter Serial riêng để theo dõi và chẩn đoán hệ thống thực tế.

## 1. Bối cảnh sử dụng

NXChieu Modbus Tool hiện hỗ trợ Master, Slave, Simulator, Traffic Log và Web Remote cho
Modbus RTU, Modbus TCP và RTU over TCP. Mục tiêu tiếp theo là biến ứng dụng thành công cụ
theo dõi và chẩn đoán đường truyền độc lập trong hệ thống đang vận hành.

Kịch bản chính:

- PLC hoặc bộ điều khiển hiện trường đang đóng vai trò Master.
- Các biến tần, đồng hồ, cảm biến, remote I/O hoặc PLC khác là Slave/Server.
- Máy tính chạy NXChieu Modbus Tool quan sát cuộc trao đổi mà không thay đổi dữ liệu.
- Kỹ thuật viên cần biết sức khỏe của bus/mạng, thiết bị nào đang hoạt động, thiết bị nào
  chậm hoặc mất phản hồi, lỗi xuất hiện ở đâu và thời điểm nào.
- Một phiên capture phải lưu được để mở lại, lọc, phân tích và gửi cho người khác điều tra.

Traffic Log hiện tại vẫn hữu ích cho các phiên Master/Slave do ứng dụng tạo ra, nhưng chưa
phải một hệ thống passive sniffer hoàn chỉnh. Dữ liệu hiện được đưa vào frontend qua
`PollResult.RawTx`, `PollResult.RawRx` và `SlaveActivityEvent`; một số frame Master được dựng
lại vì thư viện Modbus hiện tại không cung cấp hook lấy byte trực tiếp từ transport.

## 2. Mục tiêu sản phẩm

### 2.1 Mục tiêu bắt buộc

1. Thu và hiển thị byte Modbus theo thời gian thực mà không làm nghẽn đường truyền.
2. Hỗ trợ ba giao thức vận chuyển:
   - Modbus RTU qua Serial/RS485.
   - Modbus TCP.
   - Modbus RTU over TCP.
3. Giải mã request, response, exception và các trường dữ liệu của từng function code.
4. Ghép request với response thành transaction và tính response time.
5. Đánh giá sức khỏe tổng thể của bus/mạng và trạng thái từng thiết bị.
6. Phát hiện timeout, CRC sai, frame lỗi, exception, retry, mất kết nối và bất thường chu kỳ
   polling.
7. Lọc, tìm kiếm, bookmark, lưu capture, mở lại capture và xuất báo cáo.
8. Chế độ passive phải chỉ đọc; không được phát byte ra bus.
9. Chịu được dữ liệu rác, frame bị chia nhỏ, nhiều frame dính nhau và lưu lượng cao.

### 2.2 Mục tiêu nâng cao

- Tự học danh sách thiết bị và register map đang được truy cập.
- Học baseline của chu kỳ polling, latency và tỷ lệ lỗi theo thiết bị.
- Phát hiện thay đổi hành vi so với baseline.
- Cảnh báo khi có thao tác ghi FC05/06/15/16.
- So sánh hai phiên capture trước và sau khi sửa hệ thống.
- Cho phép profile thiết bị đặt tên thanh ghi, kiểu dữ liệu, scale, unit và ngưỡng cảnh báo.
- Tạo báo cáo sức khỏe theo ca, ngày hoặc khoảng thời gian được chọn.

### 2.3 Phạm vi không nên hứa quá mức

Phân tích giao thức chỉ suy luận sức khỏe liên lạc từ dữ liệu quan sát được. Phần mềm thông
thường không thể đo trực tiếp:

- Điện áp vi sai A/B, common-mode voltage.
- Sai termination, bias resistor hoặc phản xạ tín hiệu.
- Dạng sóng, ringing, slew rate hoặc nhiễu điện từ thực tế.
- Va chạm ở mức điện nếu adapter USB đã lọc hoặc làm mất byte trước khi chuyển lên máy tính.

Các hiện tượng vật lý có thể tạo dấu hiệu gián tiếp như CRC sai, frame ngắn, retry hoặc
timeout. Muốn kết luận lớp vật lý cần oscilloscope, logic analyzer hoặc RS485 analyzer có
timestamp phần cứng. Có thể tích hợp loại thiết bị này trong một giai đoạn sau.

## 3. Nguyên tắc chẩn đoán

### 3.1 Không suy diễn quá bằng chứng

Trong chế độ passive, ứng dụng chỉ biết những gì đã xuất hiện trên đường truyền:

- Có request tới Slave nhưng không có response trong thời gian kỳ vọng: có bằng chứng về
  lỗi phản hồi, lỗi đường truyền hoặc thiết bị không hoạt động.
- Không thấy PLC gửi request tới Slave: chỉ kết luận Master không polling thiết bị trong cửa
  sổ quan sát; không được kết luận Slave offline.
- Có response exception: thiết bị và đường truyền vẫn đang giao tiếp, nhưng yêu cầu bị từ
  chối ở tầng giao thức/ứng dụng.
- CRC sai: frame quan sát bị hỏng, nhưng chưa đủ để xác định bên phát, dây dẫn hay adapter là
  nguyên nhân.
- TCP reconnect hoặc reset: kết nối mạng bị gián đoạn; chưa đủ để kết luận PLC hoặc Slave bị
  mất nguồn.

Mọi cảnh báo nên có `evidence`, `confidence` và lời giải thích ngắn. Tránh chỉ hiển thị một
đèn đỏ mà không cho người dùng biết dữ liệu nào dẫn tới kết luận.

### 3.2 Read-only trước, can thiệp sau

- Passive capture không được có API write.
- Proxy chỉ chuyển tiếp nguyên byte và ghi nhận dữ liệu.
- Replay/injection, nếu được phát triển, phải là chế độ riêng, mặc định tắt và không dùng
  chung màn hình với passive monitoring.
- Không tự động probe một thiết bị trong phiên passive. Active probe chỉ được chạy khi người
  dùng chọn rõ chế độ kiểm tra chủ động.

## 4. Các chế độ thu dữ liệu

| Chế độ | Cách kết nối | Ưu điểm | Giới hạn | Ưu tiên |
|---|---|---|---|---|
| Internal capture | Thu phiên Master/Slave do ứng dụng vận hành | Dễ tích hợp, tận dụng code hiện có | Một số frame là reconstructed, không quan sát PLC ngoài | P0 |
| TCP proxy | PLC/Master kết nối vào tool; tool nối tiếp sang Slave | Byte thật, phân biệt chiều chính xác, không cần Npcap | Tool nằm trong đường truyền và trở thành một điểm lỗi | P0 |
| RTU-over-TCP proxy | Chuyển tiếp raw TCP stream có CRC | Dễ thu và giải mã | Tool nằm trong đường truyền | P0 |
| Passive Serial RTU | Adapter RS485 thứ hai mắc song song bus A/B | Không thay đổi topology logic | Cần phần cứng phù hợp; khó xác định chiều tuyệt đối | P1 |
| Passive TCP packet capture | Thu packet từ NIC bằng Npcap/libpcap | Không đổi kết nối ứng dụng | Driver, quyền hệ thống và TCP reassembly phức tạp | P2 |
| Serial bridge hai cổng | Hai adapter nối hai phía và forward | Biết rõ chiều và byte thật | Thay đổi topology/timing, có rủi ro vận hành | P2 |
| Import capture | Mở file do tool hoặc hệ thống khác tạo | Điều tra offline, tái hiện lỗi | Không phải real-time | P1 |

### 4.1 Lưu ý phần cứng khi nghe RS485

- Adapter nghe nên cách ly, trở kháng cao và có khả năng nhận mà không chủ động truyền.
- Không tự ý thêm termination 120 ohm ở điểm giữa bus.
- Kiểm tra bias và ground reference theo topology thực tế.
- Một COM đang bị phần mềm khác mở độc quyền thường không thể được ứng dụng mở lần hai.
- USB buffering làm timestamp trên máy tính có sai số; không dùng timestamp đó để tuyên bố
  chính xác timing ở mức microsecond nếu chưa hiệu chuẩn.
- Direction trong passive RTU thường được suy luận từ cấu trúc request/response và trạng thái
  transaction. Nếu không đủ bằng chứng, giữ giá trị `unknown`.

## 5. Kiến trúc đề xuất

```text
Capture Adapter
    -> Byte/Packet Stream
    -> Transport Framer
    -> Modbus Decoder
    -> Request/Response Correlator
    -> Health & Diagnostic Analyzer
    -> Capture Store
    -> Batched Event Stream
    -> Protocol Analyzer UI / Remote UI / Export
```

Tách capture, framing, decode, correlation, diagnostics và UI thành các lớp độc lập. Decoder
phải chạy được với dữ liệu live và dữ liệu đọc lại từ file.

### 5.1 Cấu trúc thư mục dự kiến

```text
pkg/sniffer/
  types.go
  session.go
  adapter.go
  capture_internal.go
  capture_tcp_proxy.go
  capture_serial.go
  capture_pcap_windows.go
  framer_tcp.go
  framer_rtu.go
  decoder.go
  decoder_read.go
  decoder_write.go
  correlator.go
  diagnostics.go
  health.go
  baseline.go
  store.go
  export.go

src/features/sniffer/
  SnifferWorkspace.tsx
  CaptureSetup.tsx
  CaptureToolbar.tsx
  FrameTable.tsx
  TransactionTable.tsx
  FrameInspector.tsx
  HexInspector.tsx
  DiagnosticPanel.tsx
  HealthDashboard.tsx
  DeviceHealthCard.tsx
  StatisticsPanel.tsx
```

Không đặt toàn bộ logic mới vào `src/App.tsx`. `App.tsx` chỉ nên điều phối workspace và
subscribe các batch event.

### 5.2 Interface capture

Interface cụ thể có thể thay đổi trong lúc triển khai, nhưng ranh giới trách nhiệm nên tương
đương ví dụ sau:

```go
type CaptureAdapter interface {
    Start(context.Context, CaptureConfig, chan<- CaptureChunk) error
    Stop() error
    Stats() CaptureStats
}

type CaptureChunk struct {
    SourceID       string
    ConnectionID   string
    DirectionHint  Direction
    CapturedAt     time.Time
    ElapsedNS      uint64
    Bytes          []byte
}
```

Adapter chỉ thu byte/packet. Adapter không giải mã Modbus và không cập nhật UI trực tiếp.

## 6. Framing theo transport

### 6.1 Modbus TCP

- Reassemble TCP stream riêng theo connection và direction.
- Đọc MBAP header 7 byte, kiểm tra Protocol ID và Length.
- Chấp nhận một packet chứa nhiều ADU và một ADU trải qua nhiều packet.
- Giới hạn độ dài trước khi cấp phát bộ nhớ.
- Khi mất packet trong passive capture, đánh dấu stream desynchronized và tìm điểm đồng bộ
  hợp lệ tiếp theo.
- Không dùng ranh giới của TCP packet làm ranh giới Modbus frame.

### 6.2 RTU over TCP

- Đây là raw RTU frame chạy trên TCP, có CRC và không có MBAP.
- Reassemble theo function code, byte count, CRC và timeout/gap cấu hình.
- Xử lý frame bị fragment hoặc coalesced.

### 6.3 Serial RTU

- Tính khoảng lặng 3,5 character theo baud, data bits, parity và stop bits.
- Kết hợp khoảng lặng với độ dài dự kiến của function code và CRC.
- Khi CRC sai, dịch từng byte để tìm lại đầu frame; không xóa toàn bộ buffer ngay.
- Đặt giới hạn buffer và counter cho noise/dropped bytes.
- Tái sử dụng có chọn lọc `CRC16Modbus` và logic `expectedRequestLen` hiện có, nhưng chuyển
  thành parser tổng quát cho cả request lẫn response.

## 7. Decoder Modbus

### 7.1 Function code giai đoạn đầu

- FC01 Read Coils.
- FC02 Read Discrete Inputs.
- FC03 Read Holding Registers.
- FC04 Read Input Registers.
- FC05 Write Single Coil.
- FC06 Write Single Register.
- FC15 Write Multiple Coils.
- FC16 Write Multiple Registers.
- Exception response (`function | 0x80`).

### 7.2 Function code mở rộng

- FC07 Read Exception Status.
- FC08 Diagnostics.
- FC11/12 communication event information/log.
- FC17 Report Server ID.
- FC22 Mask Write Register.
- FC23 Read/Write Multiple Registers.
- FC24 Read FIFO Queue.
- FC43/14 Read Device Identification.

Decoder phải trả kết quả có cấu trúc và danh sách lỗi; không panic vì input không hợp lệ.
Unknown function code vẫn phải lưu raw frame và metadata cơ bản.

## 8. Mô hình dữ liệu

### 8.1 Captured frame

```go
type CapturedFrame struct {
    ID               string           `json:"id"`
    Sequence         uint64           `json:"sequence"`
    CapturedAtUnixNS int64            `json:"captured_at_unix_ns"`
    ElapsedNS        uint64           `json:"elapsed_ns"`
    SourceID         string           `json:"source_id"`
    ConnectionID     string           `json:"connection_id,omitempty"`
    Transport        Transport        `json:"transport"`
    Direction        Direction        `json:"direction"`
    CaptureSource    CaptureSource    `json:"capture_source"`
    CaptureQuality   CaptureQuality   `json:"capture_quality"`
    Raw              []byte           `json:"raw"`
    Parsed           *DecodedModbus   `json:"parsed,omitempty"`
    ConversationID   string           `json:"conversation_id,omitempty"`
    ResponseTimeUS   uint64           `json:"response_time_us,omitempty"`
    Diagnostics      []DiagnosticItem `json:"diagnostics,omitempty"`
}
```

`CaptureQuality` tối thiểu gồm:

- `wire`: byte thu trực tiếp từ proxy/tap/packet capture.
- `reconstructed`: frame được dựng từ API/result vì transport không đưa raw byte ra ngoài.
- `partial`: frame thiếu byte hoặc stream mất đồng bộ.

Không lưu hex string làm dữ liệu gốc. Lưu `[]byte`; hex chỉ là dạng trình bày/export.

### 8.2 Transaction

```go
type Transaction struct {
    ID               string
    RequestFrameID   string
    ResponseFrameID  string
    UnitID           uint8
    FunctionCode     uint8
    StartedAtUnixNS  int64
    ResponseTimeUS   uint64
    Status           TransactionStatus
    Confidence       float64
}
```

Các trạng thái tối thiểu: `pending`, `success`, `exception`, `timeout`, `orphan_response`,
`broadcast`, `malformed`, `ambiguous`.

## 9. Correlation request-response

### 9.1 Modbus TCP

Khóa ghép chính:

```text
connection ID + transaction ID + unit ID
```

Function code dùng để kiểm tra tính nhất quán. Phải xử lý transaction ID quay vòng và nhiều
request outstanding trên cùng connection.

### 9.2 Modbus RTU

RTU không có transaction ID. Correlator dùng:

- Bus/source ID.
- Unit ID.
- Function code.
- Thứ tự thời gian.
- Request đang chờ gần nhất.
- Nội dung echo đối với FC05/06 và address/quantity đối với FC15/16.

Nếu có nhiều cách ghép hợp lệ, đánh dấu `ambiguous` và giảm confidence. Broadcast Unit ID 0
được đóng transaction ngay với trạng thái `broadcast`, không chờ response.

## 10. Health model

### 10.1 Hai cấp đánh giá

1. **Bus/Network Health**: sức khỏe chung của nguồn capture.
2. **Device Health**: sức khỏe từng Unit ID/server endpoint.

Điểm sức khỏe 0–100 chỉ là phần trình bày. Giao diện luôn phải cho xem số liệu gốc và lý do
bị trừ điểm.

### 10.2 Chỉ số bus RTU

- Tổng frame và frame/giây.
- CRC error rate.
- Malformed/partial frame rate.
- Request không có response.
- Orphan response.
- Retry rate và số request lặp lại.
- Exception rate.
- Response time P50/P95/P99 và jitter.
- Poll cycle trung bình và độ lệch chu kỳ.
- Khoảng lặng bất thường.
- Số Unit ID hoạt động.
- Ước lượng bus utilization từ số byte, framing và cấu hình serial.
- Noise/resynchronization counter.

Bus utilization RTU chỉ là ước lượng vì USB buffering làm sai lệch timestamp. Hiển thị nhãn
`estimated` và không đưa ra độ chính xác giả.

### 10.3 Chỉ số mạng TCP

- Số connection active/closed.
- Connect/reconnect/reset rate.
- Modbus transaction success/timeout/exception rate.
- Modbus response time P50/P95/P99.
- Duplicate hoặc reused transaction ID bất thường.
- MBAP/protocol/length error.
- Throughput và frame rate.
- TCP retransmission, out-of-order, zero-window chỉ có khi capture packet bằng Npcap; proxy
  ở tầng stream không được tuyên bố các chỉ số này.

### 10.4 Trạng thái thiết bị

Các trạng thái đề xuất:

- `unknown`: chưa đủ dữ liệu hoặc không có request tới thiết bị.
- `healthy`: phản hồi ổn định trong baseline/SLA.
- `degraded`: latency, retry, CRC liên quan hoặc exception vượt ngưỡng cảnh báo.
- `suspected_offline`: đã thấy một số request không có response nhưng chưa đủ điều kiện offline.
- `offline`: nhiều request liên tiếp không có response trong cửa sổ xác định.
- `not_polled`: trước đây có hoạt động nhưng Master không còn gửi request trong cửa sổ hiện tại.

`offline` chỉ được dùng khi thực sự quan sát request không được trả lời. `not_polled` tách riêng
để tránh đổ lỗi cho Slave khi PLC đã dừng polling.

### 10.5 Điểm sức khỏe tham khảo

Các trọng số ban đầu phải cấu hình được và sẽ được hiệu chỉnh bằng capture thực tế:

| Thành phần | Trọng số gợi ý |
|---|---:|
| Tỷ lệ transaction thành công | 30 |
| Toàn vẹn frame/CRC/MBAP | 25 |
| Latency so với SLA/baseline | 20 |
| Retry và độ ổn định chu kỳ | 15 |
| Exception và lỗi giao thức | 10 |

Không trừ điểm thiết bị cho CRC frame không xác định được Unit ID. Lỗi không quy được nguồn
chỉ ảnh hưởng Bus Health.

## 11. Rule engine và cảnh báo

Mỗi diagnostic nên có:

```text
rule_id, severity, scope, first_seen, last_seen, count,
evidence_frame_ids, message, recommendation, confidence
```

Rule giai đoạn đầu:

- `RTU_BAD_CRC`
- `RTU_MALFORMED_FRAME`
- `RTU_NO_RESPONSE`
- `RTU_ORPHAN_RESPONSE`
- `RTU_POLL_PERIOD_DRIFT`
- `TCP_BAD_MBAP_LENGTH`
- `TCP_BAD_PROTOCOL_ID`
- `TCP_CONNECTION_RESET`
- `MODBUS_EXCEPTION`
- `MODBUS_RETRY`
- `MODBUS_SLOW_RESPONSE`
- `MODBUS_WRITE_OBSERVED`
- `DEVICE_NOT_POLLED`
- `DEVICE_SUSPECTED_OFFLINE`
- `DEVICE_OFFLINE`
- `CAPTURE_DROPPED_DATA`
- `CAPTURE_DESYNCHRONIZED`

Ngưỡng timeout, số lần liên tiếp, latency và severity phải cấu hình theo source/device. Không
hard-code một timeout duy nhất cho mọi mạng.

## 12. Baseline và phát hiện bất thường

Baseline ban đầu có thể dùng thống kê đơn giản, không cần machine learning:

- Poll interval median và median absolute deviation.
- Response-time P50/P95/P99 theo Unit ID + function + address range.
- Request rate theo thiết bị.
- Danh sách function code/address thường gặp.
- Exception/retry rate trong cửa sổ trượt.

Cho phép hai chế độ:

- `Learn`: thu baseline nhưng chưa cảnh báo deviation.
- `Monitor`: so sánh dữ liệu mới với baseline đã lưu.

Người dùng phải biết baseline được học từ khoảng thời gian nào và có thể reset hoặc khóa nó.

## 13. Giao diện Protocol Analyzer

### 13.1 Capture setup

- Chọn Internal, TCP Proxy, RTU-over-TCP Proxy, Passive Serial, Passive TCP hoặc Open File.
- Cấu hình adapter/NIC/COM, baud, parity, stop bits, listen port và target endpoint.
- Hiển thị sơ đồ đấu nối ngắn cho từng chế độ.
- Cảnh báo rõ khi chế độ Proxy làm ứng dụng nằm trong đường truyền.
- Trạng thái `Capturing`, `Paused display`, `Stopped`, dropped data và file đang ghi.

### 13.2 Live analyzer

- Bảng frame: sequence, timestamp, delta, direction, endpoint/Unit ID, FC, address, quantity,
  summary, response time và severity.
- Transaction view: một dòng chứa request và response.
- Detail pane: decoded fields, raw hex và diagnostics.
- Chọn field trong decoded tree phải highlight đúng byte trong hex; chọn byte phải highlight
  field tương ứng.
- Bộ lọc theo thời gian, transport, direction, connection, Unit ID, FC, address, write,
  exception, severity, timeout và chuỗi hex.
- Pause display không được dừng capture.
- Bookmark, ghi chú, copy frame, copy decoded JSON và nhảy tới request/response liên quan.
- Virtualized table; không render hàng chục nghìn DOM row cùng lúc.

### 13.3 Health dashboard

- Điểm Bus/Network Health cùng lý do bị trừ điểm.
- Danh sách thiết bị với trạng thái, request rate, success rate, latency P95, last request,
  last response và active diagnostics.
- Timeline lỗi, latency và số thiết bị hoạt động.
- Ma trận Unit ID x Function Code hoặc Unit ID x address range.
- Register write audit: ai/connection nào ghi, thời điểm, địa chỉ và giá trị.

## 14. Lưu trữ và export

### 14.1 Bộ nhớ

- Backend dùng bounded ring buffer.
- UI chỉ giữ cửa sổ cần hiển thị, không giữ vô hạn trong React state.
- Capture pipeline dùng bounded channel và có dropped counter.
- Khi writer chậm, không được block adapter đọc. Ghi nhận `CAPTURE_DROPPED_DATA`.

### 14.2 File capture

MVP:

- Metadata JSON có schema version, app version, source configuration và time base.
- Frame stream dạng JSON Lines hoặc binary records tuần tự.
- Raw bytes lưu dạng base64/binary, không chỉ lưu chuỗi hex.
- Ghi theo luồng để crash không làm mất toàn bộ phiên.
- Reader bỏ qua record cuối bị ghi dở và báo capture chưa đóng sạch.

Sau MVP có thể đóng gói thành `.nxcap` gồm metadata, frame stream, bookmark, diagnostics và
device profile. Cần version schema ngay từ phiên bản đầu.

Export:

- CSV cho transaction/health summary.
- JSON/JSONL cho dữ liệu đầy đủ.
- Text hex log cho hỗ trợ nhanh.
- PCAP/PCAPNG cho TCP khi có mapping chuẩn và kiểm thử với Wireshark. Không tạo file mang đuôi
  PCAP nếu nội dung không tương thích công cụ chuẩn.

## 15. Tích hợp Wails và frontend

API dự kiến:

```text
StartSniffer(config) -> status/error
StopSniffer() -> status
PauseSnifferDisplay(paused)
GetSnifferStatus() -> status
GetSnifferFrames(query) -> page
GetSnifferTransactions(query) -> page
GetHealthSnapshot() -> snapshot
SaveCapture(path/options)
OpenCapture(path)
ExportCapture(path/format/filter)
AddCaptureBookmark(frameID/note)
```

Event dự kiến:

```text
sniffer-frame-batch
sniffer-transaction-batch
sniffer-health-update
sniffer-diagnostic
sniffer-status
```

Không emit một Wails event cho từng frame. Gợi ý batch tối đa 100 frame hoặc mỗi 50 ms,
tùy điều kiện nào đến trước. Health snapshot có thể cập nhật chậm hơn, ví dụ 500–1000 ms.

## 16. Hiệu năng và độ tin cậy

Mục tiêu ban đầu, cần đo lại bằng benchmark:

- Decoder không panic với bất kỳ byte input nào.
- Capture TCP proxy không sửa byte và không chờ UI.
- UI có thể duyệt ít nhất 50.000 frame đã lưu mà vẫn lọc/cuộn mượt.
- Backend có thể xử lý tối thiểu 10.000 Modbus frame/giây trong benchmark decoder trên máy
  phát triển thông thường.
- Mọi queue đều có giới hạn và metric chiều dài/dropped count.
- Stop capture phải đóng goroutine, connection và file đúng thứ tự, không leak.
- Crash hoặc mất điện chỉ làm mất phần buffer chưa flush, không làm hỏng toàn bộ capture.

Không tối ưu theo con số giả định nếu chưa có benchmark. Ghi benchmark và cấu hình máy vào
kết quả test.

## 17. Kiểm thử bắt buộc

### 17.1 Unit và golden tests

- Request/response hợp lệ cho từng function code.
- Exception cho từng mã chuẩn.
- CRC sai, byte count sai, MBAP length sai và unknown function.
- Frame chia thành mọi vị trí có thể.
- Nhiều frame gộp trong một chunk.
- Noise trước, giữa và sau frame RTU.
- Transaction ID quay vòng.
- Broadcast, timeout, orphan response, retry và ambiguous RTU match.
- Address/quantity ở các biên 0 và 65535.

### 17.2 Fuzz tests

- RTU framer.
- TCP framer.
- Decoder.
- Capture-file reader.

Điều kiện: không panic, không cấp phát vô hạn, không vòng lặp vô hạn và không đọc ngoài buffer.

### 17.3 Integration tests

- TCP proxy giữa master test và slave test; hai đầu nhận đúng từng byte.
- RTU-over-TCP proxy với frame fragment/coalesced.
- Serial test bằng virtual COM hoặc adapter loopback khi môi trường hỗ trợ.
- Stop/restart capture nhiều lần.
- Client disconnect giữa frame.
- Slow UI/file writer không làm deadlock capture.
- Save, reopen và replay cho kết quả decode/correlation giống phiên live.

### 17.4 Capture fixtures

Duy trì thư mục fixture đã ẩn hoặc tổng hợp, không chứa dữ liệu nhạy cảm của khách hàng:

- Bus khỏe bình thường.
- Một Slave mất phản hồi.
- CRC/noise tăng dần.
- PLC retry liên tục.
- Exception storm.
- Hai Master hoặc response mơ hồ.
- TCP reconnect/reset.
- RTU-over-TCP stream bị chia/gộp.

## 18. Lộ trình triển khai

### Phase 0 — Chuẩn hóa traffic model

Mục tiêu:

- Tạo `pkg/sniffer` và schema có version.
- Tách decode/correlation khỏi UI.
- Chuyển Traffic Log hiện tại sang event có cấu trúc.
- Gắn `capture_quality=reconstructed` cho frame dựng lại.
- Thêm test decoder/framer nền tảng.

Hoàn thành khi Traffic Box cũ có thể dùng dữ liệu từ pipeline mới mà chức năng Master/Slave
không bị ảnh hưởng.

Ước lượng: 3–5 ngày công.

### Phase 1 — Protocol Analyzer MVP

Mục tiêu:

- Decoder FC01–06, 15, 16 và exception.
- Request/response correlation.
- Frame table, transaction table, detail/hex inspector và filter.
- Ring buffer, batch event, JSONL capture và reopen.
- Diagnostics cơ bản: malformed, exception, timeout, retry, slow response.

Ước lượng: 5–8 ngày công.

### Phase 2 — TCP và RTU-over-TCP Proxy

Mục tiêu:

- Transparent byte forwarding hai chiều.
- Capture wire-quality.
- Nhiều connection đồng thời.
- Connection lifecycle, timeout, counters và integration tests.
- Health dashboard phiên bản đầu.

Ước lượng: 5–8 ngày công.

### Phase 3 — Passive Serial RTU

Mục tiêu:

- Capture COM riêng và wizard cấu hình/đấu nối.
- Gap-based framing, CRC resync và noise counters.
- Direction inference cùng confidence.
- Bus utilization estimate.
- Test với ít nhất một adapter thật và một capture lỗi thực tế.

Ước lượng: 5–8 ngày công, không tính thời gian chuẩn bị phần cứng.

### Phase 4 — Baseline và Device Health

Mục tiêu:

- Device inventory tự học.
- Learn/Monitor baseline.
- `healthy`, `degraded`, `suspected_offline`, `offline`, `not_polled`.
- Timeline, health score có giải thích và report CSV/JSON.

Ước lượng: 5–8 ngày công.

### Phase 5 — Passive TCP/Npcap

Mục tiêu:

- Chọn NIC/filter.
- Packet capture và TCP stream reassembly.
- Retransmission/out-of-order/reset analytics.
- Đóng gói driver/dependency và hướng dẫn quyền chạy trên Windows.

Ước lượng: 7–12 ngày công.

### Phase 6 — Advanced diagnostics

- Device profiles và register semantics.
- FC mở rộng.
- So sánh capture.
- Báo cáo theo ca/ngày.
- Tích hợp hardware capture có timestamp chính xác nếu có nhu cầu.

## 19. Thứ tự ưu tiên khuyến nghị

Không bắt đầu bằng Npcap. Thứ tự mang lại giá trị nhanh và ít rủi ro nhất:

1. Data model + decoder + correlator dùng chung.
2. Protocol Analyzer UI.
3. TCP/RTU-over-TCP proxy.
4. Passive RTU bằng adapter riêng.
5. Health baseline và báo cáo.
6. Passive TCP/Npcap.

TCP proxy tạo ra byte thật, direction rõ và dễ kiểm thử. Khi lõi này ổn định, passive RTU và
Npcap chỉ bổ sung capture adapter/framer, còn decoder, correlator, store và UI được tái sử dụng.

## 20. Definition of Done cho mỗi phase

Một phase chỉ hoàn thành khi:

- Có test cho dữ liệu hợp lệ, dữ liệu lỗi và lifecycle start/stop.
- Không làm hỏng test Master/Slave/Remote hiện tại.
- Không có goroutine/file/socket leak quan sát được.
- UI hiển thị được nguồn và chất lượng capture.
- Diagnostic có evidence và giải thích, không chỉ có severity.
- Có giới hạn memory/queue và dropped counter.
- Tài liệu cấu hình và sơ đồ kết nối được cập nhật.
- Capture fixture dùng trong test được lưu cùng schema version.
- Chạy `go test ./...`, frontend test, frontend build và các benchmark liên quan.

## 21. Công việc đề xuất cho sprint đầu tiên

1. Chốt schema `CapturedFrame`, `DecodedModbus`, `Transaction`, `DiagnosticItem` và
   `HealthSnapshot`.
2. Viết RTU/TCP decoder thuần, không phụ thuộc Wails/UI.
3. Viết correlator cho TCP và RTU một-request-at-a-time.
4. Tạo golden tests từ các frame đang có trong `pkg/modbus`.
5. Tạo event batcher và bounded ring buffer.
6. Chuyển Traffic Box hiện tại sang pipeline mới nhưng giữ nguyên giao diện.
7. Thêm một màn hình inspector tối thiểu để xem decoded fields và raw hex.
8. Sau khi regression test qua, mới bắt đầu TCP proxy.

## 22. Các quyết định cần ghi lại khi triển khai

Mỗi quyết định dưới đây nên được ghi vào ADR hoặc cập nhật tài liệu này:

- Định dạng file capture và chiến lược version/migration.
- Thư viện virtualized table frontend.
- Cách lấy packet trên Windows và yêu cầu Npcap.
- Chính sách timeout/correlation cho RTU.
- Công thức health score và ngưỡng mặc định.
- Có fork/instrument thư viện Modbus hiện tại để lấy byte thật hay giữ frame reconstructed.
- Cách bảo vệ proxy khi disk/UI chậm.
- Mức hỗ trợ cross-platform ngoài Windows.

## 23. Ghi chú cho coding agent

- Trước khi sửa, đọc `pkg/modbus/client.go`, `pkg/modbus/server.go`, `pkg/modbus/frames.go`,
  `pkg/modbus/crc.go`, `app.go`, `src/App.tsx`, `src/components/TrafficBox.tsx` và
  `src/types/modbus.ts`.
- Giữ capture pipeline độc lập với React và Wails.
- Không coi chunk đọc từ serial/TCP là một frame hoàn chỉnh.
- Không tạo goroutine không có cơ chế cancel/join.
- Không phát event frontend trong vòng lặp đọc byte trực tiếp.
- Không lưu capture vô hạn trong React state.
- Không gắn nhãn device offline chỉ vì không thấy traffic.
- Không tuyên bố đo lỗi vật lý RS485 từ dữ liệu giao thức nếu không có phần cứng đo.
- Mọi parser phải xử lý input thù địch mà không panic hoặc cấp phát mất kiểm soát.
- Ưu tiên fixture, golden test và fuzz test trước khi tối ưu giao diện.
