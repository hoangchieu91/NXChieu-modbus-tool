import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Smartphone,
  Wifi,
  Globe,
  Shield,
  Cable,
  Check,
  Copy,
  ExternalLink,
  Power,
  Cpu,
  Lock,
  Unlock,
  Radio,
  Share2,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  RemoteServerStatus,
  NetworkInterfaceInfo,
  TabSession,
  RegisterRow,
} from '../types/modbus';
import {
  startRemoteServer,
  stopRemoteServer,
  getRemoteServerStatus,
} from '../services/backend';

interface MobileRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions?: TabSession[];
  activeSessionId?: string;
  activeRows?: RegisterRow[];
}

export const MobileRemoteModal: React.FC<MobileRemoteModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [status, setStatus] = useState<RemoteServerStatus | null>(null);
  const [port, setPort] = useState<number>(8088);
  const [allowWrite, setAllowWrite] = useState<boolean>(false);
  const [selectedIface, setSelectedIface] = useState<NetworkInterfaceInfo | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const pollTimerRef = useRef<any>(null);

  // Load server status on open and periodically check client count
  useEffect(() => {
    if (!isOpen) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const fetchStatus = async () => {
      try {
        const s = await getRemoteServerStatus();
        setStatus(s);
        // Only mirror settings from a running server; otherwise keep what the user is editing.
        if (s.is_running) {
          setPort(s.port || 8088);
          setAllowWrite(s.allow_write);
        }

        if (s.interfaces && s.interfaces.length > 0) {
          // Priority selection: Tailscale VPN first, then local VPN, then Ethernet, then WiFi
          setSelectedIface((prev) => {
            if (prev) {
              const matched = s.interfaces.find((i) => i.ip === prev.ip);
              if (matched) return matched;
            }
            const tailscale = s.interfaces.find((i) => i.type === 'vpn_tailscale');
            if (tailscale) return tailscale;
            const vpn = s.interfaces.find((i) => i.type === 'vpn');
            if (vpn) return vpn;
            const eth = s.interfaces.find((i) => i.type === 'lan');
            if (eth) return eth;
            return s.interfaces[0];
          });
        }
      } catch (err) {
        console.error('Fetch remote status error:', err);
      }
    };

    // The server is never started automatically: it exposes device data on the network,
    // so the user must start it explicitly.
    fetchStatus();

    pollTimerRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen]);

  // Generate QR Code when selected interface or port changes
  useEffect(() => {
    if (!selectedIface) {
      setQrDataUrl('');
      return;
    }

    if (!status?.is_running) {
      setQrDataUrl('');
      return;
    }

    const currentUrl = selectedIface.url;
    QRCode.toDataURL(currentUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#020617', // slate-950
        light: '#ffffff', // pure white
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR code generation failed:', err));
  }, [selectedIface, status?.is_running]);

  // Server toggle handler
  const handleToggleServer = async () => {
    setLoading(true);
    try {
      if (status?.is_running) {
        const s = await stopRemoteServer();
        setStatus(s);
      } else {
        const s = await startRemoteServer(port, allowWrite);
        setStatus(s);
        if (s.interfaces && s.interfaces.length > 0) {
          // Re-pick the interface from the fresh status so its URL carries the new access token.
          const matched = selectedIface && s.interfaces.find((i) => i.ip === selectedIface.ip);
          const tailscale = s.interfaces.find((i) => i.type === 'vpn_tailscale');
          setSelectedIface(matched || tailscale || s.interfaces[0]);
        }
      }
    } catch (err) {
      console.error('Toggle server error:', err);
      alert(`Không khởi động được Web Remote: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!selectedIface) return;
    const url = selectedIface.url;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenBrowser = () => {
    if (!selectedIface) return;
    const url = selectedIface.url;
    window.open(url, '_blank');
  };

  if (!isOpen) return null;

  const currentUrl = selectedIface && status?.is_running ? selectedIface.url : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-5 py-3.5 select-none">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                  Giám sát từ xa
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-semibold">
                  4G VPN & LAN
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Truy cập trực tiếp qua trình duyệt di động bằng Wi-Fi xưởng hoặc 4G Tailscale VPN
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Top Control Bar: Server Status & Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center space-x-3.5">
              <div
                className={`relative flex h-4 w-4 items-center justify-center rounded-full ${
                  status?.is_running ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              >
                {status?.is_running && (
                  <span className="absolute h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-200">
                    {status?.is_running ? 'Web Server Đang Chạy' : 'Web Server Đã Dừng'}
                  </span>
                  {status?.is_running && (
                    <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      0.0.0.0:{status.port}
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-3 text-xs text-slate-400 mt-0.5">
                  <span className="flex items-center gap-1 font-mono text-cyan-400">
                    <Radio className="h-3 w-3 animate-pulse text-cyan-400" />
                    {status?.active_clients || 0} điện thoại đang kết nối trực tiếp
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleServer}
                disabled={loading}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm ${
                  status?.is_running
                    ? 'bg-rose-600/90 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                } disabled:opacity-50`}
              >
                <Power className="h-4 w-4" />
                {loading ? 'Đang xử lý...' : status?.is_running ? 'Tắt Web Server' : 'Bật Web Server'}
              </button>
            </div>
          </div>

          {/* Main Grid: Left is QR Code & URL, Right is Network Interfaces */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            {/* Left Column: QR Code Card (5 cols) */}
            <div className="md:col-span-5 flex flex-col items-center justify-center p-5 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5 text-cyan-400" />
                Quét Mã Mở Trên Điện Thoại
              </div>

              {/* QR Code Container */}
              <div className="relative p-2.5 bg-white rounded-xl shadow-lg border border-slate-200">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Remote Access QR Code"
                    className="w-48 h-48 block rounded-lg select-none"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-slate-400 text-xs">
                    Đang tạo mã QR...
                  </div>
                )}
                {status?.is_running && (
                  <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded-full shadow border-2 border-slate-900">
                    LIVE
                  </div>
                )}
              </div>

              {/* URL String Display */}
              <div className="w-full mt-4">
                <div className="flex items-center rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs font-mono text-cyan-300 truncate">
                  <span className="truncate flex-1 select-all">{currentUrl || 'http://localhost:8088'}</span>
                  <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                    <button
                      onClick={handleCopyLink}
                      title="Sao chép liên kết"
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={handleOpenBrowser}
                      title="Mở trong trình duyệt máy tính"
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 mt-2">
                {copied ? (
                  <span className="text-emerald-400 font-medium">✓ Đã sao chép liên kết vào clipboard</span>
                ) : (
                  'Mở camera điện thoại quét mã là xem ngay'
                )}
              </p>
            </div>

            {/* Right Column: Network Interfaces Selector (7 cols) */}
            <div className="md:col-span-7 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-2">
                  Chọn Đường Mạng Kết Nối (Card Mạng IP)
                </label>
                <div className="space-y-2">
                  {status?.interfaces && status.interfaces.length > 0 ? (
                    status.interfaces.map((iface) => {
                      const isSelected = selectedIface?.ip === iface.ip;
                      return (
                        <div
                          key={iface.ip}
                          onClick={() => setSelectedIface(iface)}
                          className={`cursor-pointer p-3 rounded-xl border transition flex items-center justify-between ${
                            isSelected
                              ? 'bg-cyan-950/40 border-cyan-500/80 shadow-md ring-1 ring-cyan-500/50'
                              : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div
                              className={`p-2 rounded-lg ${
                                iface.type === 'vpn_tailscale'
                                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                  : iface.type === 'vpn'
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                  : iface.type === 'wifi'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {iface.type === 'vpn_tailscale' && <Globe className="h-4 w-4" />}
                              {iface.type === 'vpn' && <Shield className="h-4 w-4" />}
                              {iface.type === 'wifi' && <Wifi className="h-4 w-4" />}
                              {iface.type === 'lan' && <Cable className="h-4 w-4" />}
                              {iface.type === 'other' && <Cpu className="h-4 w-4" />}
                            </div>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-200">{iface.description}</span>
                                {iface.type === 'vpn_tailscale' && (
                                  <span className="text-[9px] bg-purple-950 text-purple-300 border border-purple-700 font-semibold px-1.5 py-0.2 rounded">
                                    4G Khuyên Dùng
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center gap-1.5">
                                <span className="text-cyan-400 font-semibold">{iface.ip}</span>
                                <span className="text-slate-600">({iface.name})</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center">
                            {isSelected ? (
                              <div className="h-5 w-5 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center font-bold text-xs">
                                ✓
                              </div>
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-slate-700" />
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-xs text-slate-500 py-4 text-center">
                      Không tìm thấy card mạng IPv4 nào.
                    </div>
                  )}
                </div>
              </div>

              {/* Server Options */}
              <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Cài Đặt Cổng & Phân Quyền
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Cổng Web (Port)</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      disabled={status?.is_running}
                      className="w-full rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-cyan-500 outline-none disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Quyền Ghi Từ Điện Thoại</label>
                    <button
                      type="button"
                      onClick={() => setAllowWrite(!allowWrite)}
                      // Applied when the server starts; toggling while running would only change the label.
                      disabled={status?.is_running}
                      className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold border transition ${
                        allowWrite
                          ? 'bg-emerald-950/40 border-emerald-700 text-emerald-400'
                          : 'bg-amber-950/40 border-amber-700 text-amber-400'
                      }`}
                    >
                      {allowWrite ? (
                        <>
                          <Unlock className="h-3.5 w-3.5" />
                          <span>Cho Phép Ghi (R/W)</span>
                        </>
                      ) : (
                        <>
                          <Lock className="h-3.5 w-3.5" />
                          <span>Chỉ Đọc (Read-Only)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Guide & Raspberry Pi Architecture Note */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 text-xs text-slate-400 space-y-2">
            <div className="text-slate-300 font-semibold flex items-center gap-1.5">
              <span>💡</span> Hướng Dẫn Sử Dụng & Kịch Bản Triển Khai
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] leading-relaxed">
              <div className="space-y-1">
                <p>
                  <strong className="text-slate-300">1. Xem trong cùng mạng Wi-Fi:</strong> Chọn card mạng Wi-Fi hoặc LAN, điện thoại bắt cùng Wi-Fi xưởng là quét mã xem trực tiếp với độ trễ &lt; 10ms.
                </p>
                <p>
                  <strong className="text-slate-300">2. Xem qua 4G khi ra ngoài:</strong> Chọn card <strong>Tailscale VPN</strong> (IP 100.x.x.x). Bật app Tailscale hoặc WireGuard trên điện thoại, quét mã là xem thông suốt từ bất kỳ đâu qua sóng 4G/5G.
                </p>
              </div>
              <div className="space-y-1">
                <p>
                  <strong className="text-slate-300">3. Không cần cài ứng dụng:</strong> Chạy trực tiếp trên Safari / Chrome di động, hỗ trợ Dark Mode công nghiệp và thẻ KPI số lớn dễ nhìn khi thao tác ngoài tủ điện.
                </p>
                <p>
                  <strong className="text-slate-300">4. Kịch bản Raspberry Pi:</strong> Kiến trúc Web Remote Server này sẵn sàng chạy headless trên bo mạch Raspberry Pi cắm RS485 trong tủ điện, phục vụ màn hình cho điện thoại kỹ thuật viên 24/7.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-5 py-3 text-xs select-none">
          <div className="text-slate-500 font-mono text-[11px]">
            NXChieu Modbus Remote Engine • WebSocket v1.5
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
          >
            Đóng Cửa Sổ
          </button>
        </div>
      </div>
    </div>
  );
};
