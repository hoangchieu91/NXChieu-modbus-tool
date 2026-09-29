import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Rocket,
  Radio,
  Shield,
  Columns2,
  TrendingUp,
  Keyboard,
  CheckCircle2,
  FileSpreadsheet,
  Search,
} from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type HelpTab = 'quickstart' | 'master' | 'slave' | 'splitview' | 'chart' | 'scanner' | 'hotkeys';


export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<HelpTab>('quickstart');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-200 font-sans animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-950/60 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-600/20 text-cyan-400 border border-cyan-500/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>Hướng Dẫn Sử Dụng NXChieu Modbus Tool</span>
                <span className="text-xs bg-cyan-950 text-cyan-400 border border-cyan-800/60 px-2 py-0.5 rounded-full font-mono font-normal">
                  v2.0 2-in-1 Suite
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Tài liệu kỹ thuật và cẩm nang vận hành chi tiết Modbus Master, Slave và Biểu đồ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex items-center space-x-1 px-6 pt-3 bg-slate-900/40 border-b border-slate-800 text-xs overflow-x-auto select-none">
          <button
            onClick={() => setActiveTab('quickstart')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'quickstart'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Khởi Động Nhanh</span>
          </button>

          <button
            onClick={() => setActiveTab('master')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'master'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Modbus Master</span>
          </button>

          <button
            onClick={() => setActiveTab('slave')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'slave'
                ? 'border-amber-400 text-amber-300 bg-amber-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Modbus Slave (Giả Lập)</span>
          </button>

          <button
            onClick={() => setActiveTab('splitview')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'splitview'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span>Split View (So Sánh)</span>
          </button>

          <button
            onClick={() => setActiveTab('chart')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'chart'
                ? 'border-sky-400 text-sky-300 bg-sky-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Biểu Đồ Xu Hướng</span>
          </button>

          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'scanner'
                ? 'border-emerald-400 text-emerald-300 bg-emerald-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Bộ Quét & Thám Tử (F4)</span>
          </button>

          <button
            onClick={() => setActiveTab('hotkeys')}
            className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
              activeTab === 'hotkeys'
                ? 'border-purple-400 text-purple-300 bg-purple-950/30 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Phím Tắt</span>
          </button>
        </div>


        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm leading-relaxed">
          {/* TAB 1: QUICK START */}
          {activeTab === 'quickstart' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
                <h3 className="text-base font-semibold text-cyan-400 flex items-center space-x-2">
                  <Rocket className="w-4 h-4" />
                  <span>3 Bước Đơn Giản Để Bắt Đầu</span>
                </h3>
                <p className="text-slate-400 mt-1 text-xs">
                  NXChieu Modbus Tool tích hợp đồng thời cả Master và Slave server, hỗ trợ cả RTU (Serial COM), TCP và RTU over TCP.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-cyan-400 font-bold text-xs uppercase mb-1">Bước 1</div>
                    <div className="font-semibold text-slate-200 text-sm">Kết Nối (Connect)</div>
                    <div className="text-slate-400 text-xs mt-1">
                      Bấm nút <span className="text-cyan-300 font-semibold">Connect (F3)</span>. Chọn cổng Serial COM (ví dụ COM1, Baud 9600) hoặc TCP IP (192.168.1.100, Port 502).
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-cyan-400 font-bold text-xs uppercase mb-1">Bước 2</div>
                    <div className="font-semibold text-slate-200 text-sm">Cài Đặt Vùng Đọc (F8)</div>
                    <div className="text-slate-400 text-xs mt-1">
                      Bấm <span className="text-cyan-300 font-semibold">Definition (F8)</span>. Chọn Slave ID, Function Code (03 Holding, 04 Input, 01 Coils), Địa chỉ bắt đầu và Số lượng thanh ghi.
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-cyan-400 font-bold text-xs uppercase mb-1">Bước 3</div>
                    <div className="font-semibold text-slate-200 text-sm">Bắt Đầu Quét (Poll)</div>
                    <div className="text-slate-400 text-xs mt-1">
                      Bấm nút <span className="text-emerald-400 font-semibold">Poll</span> để quét liên tục hoặc <span className="text-sky-300 font-semibold">Read Once (F7)</span> để đọc 1 lần. Dữ liệu sẽ nhảy tức thì lên lưới.
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Simulator */}
              <div className="bg-indigo-950/30 p-4 rounded-lg border border-indigo-800/40 flex items-start space-x-3">
                <CheckCircle2 className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-indigo-300 text-sm">Thử nghiệm ngay không cần phần cứng (Virtual Sim)</h4>
                  <p className="text-xs text-indigo-200/80 mt-1">
                    Nếu bạn chưa cắm cáp Modbus hoặc thiết bị đo, trên thanh menu trên cùng hãy bấm <span className="font-semibold text-indigo-300">Virtual Sim</span>. Ứng dụng sẽ tự động kết nối vào đồng hồ điện ảo với điện áp (220V), dòng điện (5A), công suất và tần số nhảy sóng tự nhiên.
                  </p>
                </div>
              </div>

              {/* Multi-sheet & Auto-save */}
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-2">
                <h4 className="font-bold text-slate-200 text-sm flex items-center space-x-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Quản Lý Nhiều Sheet & Tự Động Lưu Trữ (Auto-Save)</span>
                </h4>
                <p className="text-xs text-slate-400">
                  - Bấm nút <strong>+ New Sheet</strong> trên thanh công cụ để mở thêm các tab mới (mỗi tab có thể là Master đọc thiết bị riêng, hoặc Slave Server riêng biệt).
                  <br />
                  - <strong>Nhấp đúp chuột vào tên Sheet</strong> trên thanh tab để đổi tên (ví dụ: "Đồng hồ tổng", "Tủ ATS", "Biến tần Bơm 1").
                  <br />
                  - Mọi cài đặt, tên biến (Alias), đơn vị, hệ số scale, kiểu giải mã và danh sách Sheet đều được <strong>tự động lưu vĩnh viễn</strong>. Lần sau mở app sẽ phục hồi y hệt!
                  <br />
                  - Sử dụng <strong>Lưu Dự Án (.nxmodbus)</strong> và <strong>Mở Dự Án</strong> để sao lưu hoặc bàn giao cấu hình cho đồng nghiệp.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: MODBUS MASTER */}
          {activeTab === 'master' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-3">
                <h3 className="text-base font-semibold text-cyan-400 flex items-center space-x-2">
                  <Radio className="w-4 h-4" />
                  <span>Tính Năng Chuyên Sâu Của Modbus Master</span>
                </h3>

                <div className="space-y-3">
                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-amber-300 text-sm">1. Sửa Giá Trị Trực Tiếp (Click & Enter)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Không cần mở hộp thoại phức tạp! Bạn chỉ cần <strong>nhấp chuột trái vào ô Value</strong> của thanh ghi bất kỳ, gõ số mới (hỗ trợ cả số thập phân hoặc hex dạng <code>0x1234</code>) và nhấn <strong>Enter</strong> để ghi tức thì xuống thiết bị. Nhấn Esc để hủy.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-emerald-300 text-sm">2. Đảo Trạng Thái Bật/Tắt Coil (1-Click Toggle)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Khi đọc Coil (Function Code 01) hoặc Input Status (02), ô giá trị hiển thị nút bấm trạng thái <code>ON (1)</code> hoặc <code>OFF (0)</code>. Nhấp trực tiếp vào nút để gửi lệnh Write Single Coil đảo trạng thái ngay lập tức.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-indigo-300 text-sm">3. Giải Mã Thanh Ghi Độc Lập Cho Từng Hàng (Format Override)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Trong thực tế, một thiết bị có thể chứa cả biến 16-bit và 32-bit (như Điện áp Float, Dòng điện Float, Trạng thái Unsigned16, Nhiệt độ Signed16).
                      <br />
                      Tại cột <strong>Giải mã (Format)</strong>, bạn có thể chọn riêng kiểu giải mã cho từng thanh ghi. Chọn <code>Float 32 (ABCD / CDAB)</code> sẽ tự động gộp 2 thanh ghi liên tiếp thành số thực dấu chấm động chuẩn xác.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-slate-300 text-sm">4. Cột Thời Gian "Cập Nhật (Time)"</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Mỗi khi nhận được gói tin phản hồi hợp lệ, thời gian nhận gói (chính xác đến mili-giây) sẽ được cập nhật. Nếu giá trị không đổi nhưng thời gian vẫn nhảy đều, chứng tỏ thiết bị vẫn đang kết nối thông suốt.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-cyan-300 text-sm">5. Giám Sát Khung Truyền Hex (Traffic Sniffer)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Bật khung <strong>Traffic Log</strong> để xem trực tiếp các byte Hex truyền đi (TX) và phản hồi về (RX) theo chuẩn Modbus RTU/TCP để bắt lỗi CRC, Timeout hoặc Exception code (01, 02, 03, 04).
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-emerald-300 text-sm">6. Thanh Lọc & Tìm Kiếm Nhanh (Search & Filter)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Khi cấu hình đọc danh sách lớn (50-100 thanh ghi), sử dụng ô tìm kiếm ở góc trên bảng DataGrid để lọc tức thời theo địa chỉ Modbus (ví dụ <code>40005</code>) hoặc theo tên biến Alias (ví dụ <code>áp</code>, <code>dòng</code>, <code>nhiệt</code>).
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-fuchsia-300 text-sm">7. Chế Độ Xem Đa Cột Trực Tiếp (Multi-Column Live Mode)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Nhấn nút <strong>⊞ Xem Đa Cột (Live)</strong> ở đầu bảng để mở rộng hiển thị đồng thời tất cả các dạng giải mã (UInt16, Int16, Int32 ABCD/CDAB, Float32 ABCD/CDAB, Đồng hồ nước 48-bit BE/BCD). Số liệu nhảy trực tiếp theo chu kỳ poll mà không cần mở popup!
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-amber-300 text-sm">8. Chớp Sáng & Mũi Tên Chỉ Báo Biến Thiên (Value Change Glow)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Khi giá trị thanh ghi thay đổi giữa 2 chu kỳ: nền ô giá trị chớp sáng dịu mắt (xanh lục nếu tăng, đỏ cam nếu giảm) kèm mũi tên <code>▲</code> hoặc <code>▼</code> hiển thị xu hướng biến thiên ngay lập tức.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-slate-300 text-sm">9. Mật Độ Hiển Thị Bảng (Density: Chuẩn / Gọn)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Chuyển đổi giữa <strong>Chuẩn</strong> (khoảng cách thoáng) và <strong>Gọn</strong> (thu nhỏ dòng) để hiển thị được nhiều thanh ghi hơn trên cùng một màn hình mà không cần cuộn chuột.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          )}

          {/* TAB 3: MODBUS SLAVE */}
          {activeTab === 'slave' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-3">
                <h3 className="text-base font-semibold text-amber-400 flex items-center space-x-2">
                  <Shield className="w-4 h-4" />
                  <span>Modbus Slave Server (Giả Lập Thiết Bị Độc Lập)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Biến máy tính của bạn thành một PLC / Sensor Modbus hoàn chỉnh để các phần mềm SCADA, DCS hoặc Modbus Master khác kết nối đọc/ghi dữ liệu.
                </p>

                <div className="space-y-3">
                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-amber-300 text-sm">1. Khởi Chạy Server (Listen Server)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Bấm nút <strong>Listen Server</strong> trên thanh công cụ. Bạn có thể vào <strong>Slave Setup</strong> để cài đặt:
                      <br />
                      - <strong>TCP Server:</strong> Mở cổng IP (mặc định Port 502 hoặc 5020).
                      <br />
                      - <strong>Serial COM Server:</strong> Lắng nghe trực tiếp trên cổng COM với Baudrate tùy chỉnh.
                      <br />
                      - <strong>Slave ID:</strong> Đặt địa chỉ trạm (ví dụ trạm 1, trạm 2...).
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-emerald-300 text-sm">2. Bốn Bảng Nhớ Chuẩn Công Nghiệp</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Chuyển đổi tức thì giữa 4 vùng nhớ qua dropdown <strong>Memory Table</strong>:
                      <br />
                      • <strong>4x Holding Registers:</strong> Thanh ghi đọc/ghi 16-bit (FC 03, 06, 16).
                      <br />
                      • <strong>3x Input Registers:</strong> Thanh ghi chỉ đọc 16-bit (FC 04).
                      <br />
                      • <strong>0x Discrete Coils:</strong> Tiếp điểm đọc/ghi 1-bit (FC 01, 05, 15).
                      <br />
                      • <strong>1x Discrete Inputs:</strong> Đầu vào số chỉ đọc 1-bit (FC 02).
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-cyan-300 text-sm">3. Bộ Mô Phỏng Tín Hiệu Tự Động (Simulation Engine)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Trong <strong>Slave Setup</strong>, kích hoạt bộ mô phỏng để tự động sinh dữ liệu test:
                      <br />
                      - <strong>Sine Wave:</strong> Sóng hình sin dao động tuần hoàn (rất thích hợp vẽ biểu đồ).
                      <br />
                      - <strong>Increment:</strong> Bộ đếm tăng dần rồi tràn về giá trị Min.
                      <br />
                      - <strong>Random:</strong> Giá trị ngẫu nhiên trong dải Min - Max.
                      <br />
                      - <strong>Toggle:</strong> Tự động đảo trạng thái ON/OFF theo chu kỳ.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SPLIT VIEW */}
          {activeTab === 'splitview' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-3">
                <h3 className="text-base font-semibold text-indigo-400 flex items-center space-x-2">
                  <Columns2 className="w-4 h-4" />
                  <span>Chế Độ Xem Song Song 2 Cửa Sổ (Split View)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Tính năng độc đáo cho phép chia đôi màn hình ứng dụng để quan sát đồng thời 2 Sheet khác nhau.
                </p>

                <div className="space-y-3">
                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-indigo-300 text-sm">Mục Đích Ứng Dụng:</span>
                    <ul className="list-disc list-inside text-xs text-slate-300 mt-1 space-y-1">
                      <li>
                        <strong>So sánh Master vs Slave:</strong> Cột trái mở Master đọc thiết bị thật, Cột phải mở Slave giả lập để kiểm tra tính toàn vẹn dữ liệu truyền nhận.
                      </li>
                      <li>
                        <strong>So sánh 2 thiết bị đo:</strong> Cột trái là Đồng hồ Điện 1, Cột phải là Đồng hồ Điện 2 để đối chiếu lệch pha, áp, công suất tức thời.
                      </li>
                      <li>
                        <strong>So sánh 2 cổng truyền thông:</strong> So sánh dữ liệu thu được qua RTU RS485 và dữ liệu thu được qua Gateway Modbus TCP.
                      </li>
                    </ul>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-cyan-300 text-sm">Cách Sử Dụng:</span>
                    <p className="text-xs text-slate-400 mt-1">
                      1. Bấm nút <strong>`Split View`</strong> trên thanh Toolbar.
                      <br />
                      2. Cửa sổ bên phải sẽ xuất hiện danh sách chọn Sheet. Bạn có thể chọn bất kỳ Sheet nào trong dự án để hiển thị.
                      <br />
                      3. Cả 2 cửa sổ đều hoạt động độc lập, có thể cuộn, chỉnh sửa và nhận dữ liệu real-time cùng lúc.
                      <br />
                      4. Bấm <strong>✕ Đóng Split</strong> để trở về giao diện đơn màn hình.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: CHART */}
          {activeTab === 'chart' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-3">
                <h3 className="text-base font-semibold text-sky-400 flex items-center space-x-2">
                  <TrendingUp className="w-4 h-4" />
                  <span>Biểu Đồ Xu Hướng Đa Kênh (Multi-line Trend Chart)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Được thiết kế theo phong cách MQTT Explorer với tốc độ vẽ 60FPS bằng Canvas, hỗ trợ nhiều đường tín hiệu và thao tác cử chỉ mượt mà.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-sky-300 text-sm">Thêm nhiều đường vào biểu đồ</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Bấm vào biểu tượng 📈 ở cột Thao Tác của thanh ghi bất kỳ để thêm biến đó vào biểu đồ. Bạn có thể thêm nhiều biến (ví dụ cả 3 pha Ua, Ub, Uc) để so sánh trên cùng một trục.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-amber-300 text-sm">Kéo chuột di chuyển (Pan)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Nhấn giữ chuột trái trên đồ thị và kéo ngang sang trái/phải để tua lại xem dữ liệu quá khứ. Bấm nút <strong>🔴 Trở Về Live</strong> để quay về bám sóng trực tiếp.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-emerald-300 text-sm">Lăn chuột phóng to/thu nhỏ (Zoom)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Dùng con lăn chuột (hoặc bấm nút Zoom In / Zoom Out) để phóng to xem chi tiết từng mẫu đo hoặc thu nhỏ để bao quát xu hướng hàng giờ.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <span className="font-bold text-purple-300 text-sm">Rê chuột soi giá trị (Crosshair)</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Rê chuột trên đồ thị để bật đường ngắm gióng đứng. Một hộp Tooltip nổi bật sẽ hiển thị chính xác mốc thời gian và giá trị từng kênh tại vị trí trỏ chuột.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded border border-slate-800">
                  <span className="font-bold text-fuchsia-300 text-sm">Thang Đo Chuẩn Hóa Tự Động (Auto-Normalized Scale %)</span>
                  <p className="text-xs text-slate-400 mt-1">
                    Khi theo dõi đồng thời các đại lượng có biên độ chênh lệch lớn (ví dụ: Điện áp <strong>220V</strong> và Dòng điện <strong>5A</strong>), đường 5A sẽ bị dẹt sát đáy nếu dùng chung 1 trục.
                    <br />
                    Nhấn nút <strong>Thang %</strong> trên thanh điều khiển biểu đồ: Mỗi kênh sẽ tự động co giãn biên độ theo dải Min-Max riêng của nó, giúp bạn quan sát rõ dao động sóng hình sin của cả dòng, áp, công suất và tần số cùng một lúc!
                  </p>
                </div>

                <div className="p-3 bg-slate-900 rounded border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-200">Xuất dữ liệu biểu đồ ra CSV</span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      Bấm biểu tượng Download trên góc phải biểu đồ để tải toàn bộ các kênh và mốc thời gian về máy tính.
                    </p>
                  </div>
                  <span className="bg-slate-800 px-2.5 py-1 rounded text-cyan-400 font-mono text-xs">.CSV Excel Compatible</span>
                </div>
              </div>
            </div>

          )}

          {/* TAB 6: SCANNER & MULTI-COLUMN EXPLORER */}
          {activeTab === 'scanner' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
                <h3 className="text-base font-semibold text-emerald-400 flex items-center space-x-2">
                  <Search className="w-4 h-4" />
                  <span>Bộ Quét & Thám Tử Modbus (Industrial Scanner & Explorer)</span>
                </h3>
                <p className="text-slate-300 mt-2">
                  Khi đến hiện trường tích hợp thiết bị mới mà không có tài liệu kỹ thuật hoặc không rõ thông số truyền thông, bộ quét sẽ tự động kiểm tra và phân tích giải mã toàn diện mà không cần đoán mò.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                    <span className="font-semibold text-cyan-300 text-xs block mb-1">
                      1. Quét Địa Chỉ Slave ID
                    </span>
                    <p className="text-slate-400 text-xs">
                      Dò tìm tuần tự dải địa chỉ Slave (ví dụ 1 - 247). Hệ thống phân biệt rõ: Phản hồi hợp lệ (Online), Phản hồi lỗi Modbus Exception (Online - có thiết bị nhưng sai FC/Address), và Timeout (Offline).
                    </p>
                  </div>
                  <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                    <span className="font-semibold text-amber-300 text-xs block mb-1">
                      2. Tự Động Dò Tốc Độ Baudrate
                    </span>
                    <p className="text-slate-400 text-xs">
                      Thử nghiệm lần lượt các cặp Baudrate (2400 đến 115200) và Parity (None, Even, Odd). Khi thiết bị phản hồi ACK, hệ thống báo ngay thông số chính xác và cho phép kết nối 1-click.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                    <span className="font-semibold text-fuchsia-300 text-xs block mb-1">
                      3. Giải Mã Đa Cột Động
                    </span>
                    <p className="text-slate-400 text-xs">
                      Hiển thị đồng thời tất cả các dạng giải mã: Int16, UInt16, Int32 (ABCD/CDAB), UInt32, Float32 (4 byte-order), Int64/UInt64, và đặc biệt là <strong>Đồng hồ nước 48-bit (BE/LE & BCD 12 số)</strong>!
                    </p>
                  </div>
                </div>
              </div>

              {/* Water meter detailed guide */}
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
                <h4 className="text-sm font-bold text-fuchsia-400 flex items-center space-x-1.5">
                  <span>🌊 Chuyên Đề: Giải Mã Đồng Hồ Nước 48-bit (3 Thanh Ghi 16-bit / 6 Bytes)</span>
                </h4>
                <p className="text-slate-300 mt-2 text-xs">
                  Nhiều dòng lưu lượng kế và đồng hồ nước công nghiệp (Zenner, George Fischer, Kent/Elster, Unimag...) sử dụng 3 thanh ghi 16-bit liên tiếp để truyền chỉ số tổng (Totalizer):
                </p>
                <div className="space-y-2 mt-2 text-xs">
                  <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800 font-mono">
                    <strong className="text-cyan-400">1. Số nguyên 48-bit (Integer 48-bit):</strong>
                    <div className="text-slate-300 mt-1">
                      • Big-Endian: <code className="text-amber-300">(R0 &lt;&lt; 32) | (R1 &lt;&lt; 16) | R2</code>
                      <br />
                      • Little-Endian: <code className="text-amber-300">(R2 &lt;&lt; 32) | (R1 &lt;&lt; 16) | R0</code>
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800 font-mono">
                    <strong className="text-pink-400">2. Mã hóa BCD 48-bit (Binary Coded Decimal - 12 Con Lăn Cơ Khí):</strong>
                    <div className="text-slate-300 mt-1">
                      Mỗi byte chứa 2 chữ số BCD (tổng 12 chữ số cho 6 bytes). Ví dụ giá trị hex <code className="text-amber-300">0x0012 0x3456 0x7890</code> sẽ giải mã thành chỉ số cơ học thực tế: <code className="text-emerald-400">1234567890</code>.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: HOTKEYS */}
          {activeTab === 'hotkeys' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
                <h3 className="text-base font-semibold text-purple-400 flex items-center space-x-2">
                  <Keyboard className="w-4 h-4" />
                  <span>Danh Mục Phím Tắt Tiện Dụng</span>
                </h3>
                <p className="text-slate-400 mt-1 text-xs">
                  Tăng tốc thao tác vận hành kiểm thử Modbus tại hiện trường bằng các phím tắt nhanh.
                </p>

                <div className="divide-y divide-slate-800 mt-3 text-xs">
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300">Mở hướng dẫn sử dụng (Help)</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-cyan-400 font-mono font-bold">F1</kbd>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300">Kết nối / Ngắt kết nối (Connect / Disconnect)</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-cyan-400 font-mono font-bold">F3</kbd>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-emerald-400">Mở Bộ Quét & Thám Tử Modbus (Scanner)</span>
                    <kbd className="px-2 py-1 bg-emerald-950 border border-emerald-700 rounded text-emerald-300 font-mono font-bold">F4</kbd>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300">Đọc 1 lần (Read Once)</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-cyan-400 font-mono font-bold">F7</kbd>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300">Cài đặt khung đọc (Setup Definition)</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-cyan-400 font-mono font-bold">F8</kbd>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300">Ghi giá trị thanh ghi (khi đang nhập ô Value)</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-amber-400 font-mono font-bold">Enter ↵</kbd>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-300">Hủy sửa giá trị hoặc đóng các cửa sổ Modal</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-400 font-mono font-bold">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-950/60 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Hệ thống phát triển bởi <span className="text-slate-200 font-semibold">Nguyễn Xuong Chiểu (nxchieu)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors shadow-sm"
          >
            Đã Hiểu & Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
