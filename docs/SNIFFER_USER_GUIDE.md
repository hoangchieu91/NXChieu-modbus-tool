# Hướng dẫn Modbus Protocol Analyzer

## Mở Analyzer

Trong cửa sổ chính, mở **Traffic Log** và chọn **Analyzer**. Analyzer vẫn nhận các frame từ
Master/Slave do ứng dụng vận hành. Frame dựng lại từ kết quả API có nhãn `reconstructed`;
frame thu trực tiếp từ proxy hoặc COM có nhãn `wire`.

Nút **Capture** mở cấu hình nguồn thu ngoài. Nút **Frames / Transactions** chuyển giữa từng
ADU và request-response đã ghép. **Chỉ lỗi** lọc exception, timeout, CRC/MBAP lỗi, retry và
các diagnostic khác.

## Modbus TCP Proxy

Sơ đồ:

```text
PLC / SCADA Master  ->  NXChieu TCP Proxy  ->  Modbus TCP Slave
                         listen port            target host:port
```

1. Trong **Capture**, chọn **Modbus TCP Proxy**.
2. Đặt Listen Port, ví dụ `1502`.
3. Đặt Target Host và Target Port của thiết bị thật, thường là `502`.
4. Bấm **Start**.
5. Đổi địa chỉ kết nối trên PLC/SCADA sang IP máy chạy NXChieu và Listen Port.
6. Khi kiểm tra xong, bấm **Stop** rồi trả cấu hình PLC/SCADA về topology ban đầu nếu cần.

Proxy chuyển tiếp nguyên byte và hỗ trợ nhiều TCP connection. Máy tính trở thành một phần của
đường truyền; đóng ứng dụng, mất nguồn hoặc firewall chặn listen port sẽ làm liên lạc qua proxy
dừng. Nên thử ngoài giờ sản xuất trước khi đưa vào hệ thống đang chạy.

## RTU over TCP Proxy

Chọn **RTU over TCP Proxy** khi TCP payload chứa nguyên frame RTU có CRC, không có MBAP header.
Cấu hình Listen/Target giống TCP Proxy. Không dùng chế độ này cho Modbus TCP chuẩn.

## Passive Serial RTU

Sơ đồ:

```text
PLC Master ---- RS485 A/B ---- Slave(s)
                    |
             adapter nghe riêng
                    |
             NXChieu Passive Serial
```

1. Dùng adapter RS485 riêng, ưu tiên loại cách ly và có receiver trở kháng cao.
2. Nối A/B đúng cực và nối reference ground theo yêu cầu của hệ thống.
3. Không thêm điện trở termination 120 ohm tại điểm nghe giữa bus.
4. Chọn **Passive Serial RTU**, COM, baud và parity đúng với bus rồi bấm **Start**.

Chế độ này không gọi API ghi và không chủ động phát Modbus. Tuy vậy, một số adapter tự điều
khiển TX hoặc tạo tải điện lên bus; phải kiểm tra phần cứng trước khi mắc vào hệ thống thật.
Windows thường không cho hai phần mềm mở cùng một COM. Analyzer cần adapter/COM nghe riêng.

## Đọc trạng thái sức khỏe

- `healthy`: request-response ổn định trong cửa sổ quan sát.
- `degraded`: có exception, timeout hoặc tỷ lệ phản hồi giảm.
- `suspected_offline`: đã quan sát nhiều request nhưng ít response.
- `offline`: ít nhất năm timeout và tỷ lệ thành công dưới 25%.
- `not_polled`: thiết bị từng phản hồi nhưng Master không gửi request mới trong 30 giây.
- `unknown`: chưa đủ bằng chứng.

`not_polled` không có nghĩa Slave hỏng. Nếu không thấy request tới một Unit ID, Analyzer chỉ có
thể kết luận Master không polling Unit đó trong khoảng quan sát.

## Diagnostic hiện có

- `RTU_BAD_CRC`, `TCP_BAD_MBAP`, `MODBUS_MALFORMED`
- `MODBUS_NO_RESPONSE`, `MODBUS_ORPHAN_RESPONSE`, `MODBUS_RETRY`
- `MODBUS_EXCEPTION`, `MODBUS_SLOW_RESPONSE`
- `MODBUS_WRITE_OBSERVED`

Ngưỡng slow response mặc định hiện là 500 ms. Điểm health dùng để sàng lọc nhanh; khi điều tra,
luôn mở frame và đọc evidence, raw hex, response time và capture quality.

## Lưu và chia sẻ

- **NXCAP** lưu tối đa 50.000 frame đang nằm trong ring buffer, raw byte, timestamp, nguồn thu
  và schema version.
- **Open** mở lại file `.nxcap` và tính lại correlation/health bằng engine hiện tại.
- **CSV** xuất bảng frame đã giải mã để lọc trong Excel hoặc gửi kèm báo cáo sự cố.

File capture có thể chứa dữ liệu vận hành, địa chỉ thiết bị và giá trị thanh ghi. Xử lý file theo
quy định bảo mật của hệ thống nhà máy.

## Giới hạn hiện tại

Passive TCP trực tiếp từ card mạng chưa được bật trong bản này vì cần Npcap/driver capture và
quyền hệ thống. Dùng TCP Proxy để có direction và byte chính xác mà không phụ thuộc driver.
Analyzer không đo điện áp A/B, termination, bias, ringing hoặc nhiễu điện từ; CRC/timeout chỉ là
dấu hiệu giao thức, không thay thế oscilloscope hay RS485 analyzer chuyên dụng.
