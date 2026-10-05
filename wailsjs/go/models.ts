export namespace modbus {
	
	export class BaudScanItem {
	    baud_rate: number;
	    parity: string;
	    stop_bits: number;
	    success: boolean;
	    latency_ms: number;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new BaudScanItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baud_rate = source["baud_rate"];
	        this.parity = source["parity"];
	        this.stop_bits = source["stop_bits"];
	        this.success = source["success"];
	        this.latency_ms = source["latency_ms"];
	        this.detail = source["detail"];
	    }
	}
	export class ConnectionConfig {
	    type: string;
	    port?: string;
	    baud_rate?: number;
	    data_bits?: number;
	    parity?: string;
	    stop_bits?: number;
	    host?: string;
	    port_tcp?: number;
	    timeout_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.port = source["port"];
	        this.baud_rate = source["baud_rate"];
	        this.data_bits = source["data_bits"];
	        this.parity = source["parity"];
	        this.stop_bits = source["stop_bits"];
	        this.host = source["host"];
	        this.port_tcp = source["port_tcp"];
	        this.timeout_ms = source["timeout_ms"];
	    }
	}
	export class PollDefinition {
	    slave_id: number;
	    function_code: number;
	    start_address: number;
	    quantity: number;
	    scan_rate_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new PollDefinition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slave_id = source["slave_id"];
	        this.function_code = source["function_code"];
	        this.start_address = source["start_address"];
	        this.quantity = source["quantity"];
	        this.scan_rate_ms = source["scan_rate_ms"];
	    }
	}
	export class PollResult {
	    session_id?: string;
	    timestamp: string;
	    slave_id: number;
	    function_code: number;
	    start_address: number;
	    values: number[];
	    bool_values: boolean[];
	    is_coil: boolean;
	    tx_count: number;
	    err_count: number;
	    latency_ms: number;
	    error?: string;
	    raw_tx?: string;
	    raw_rx?: string;
	
	    static createFrom(source: any = {}) {
	        return new PollResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.timestamp = source["timestamp"];
	        this.slave_id = source["slave_id"];
	        this.function_code = source["function_code"];
	        this.start_address = source["start_address"];
	        this.values = source["values"];
	        this.bool_values = source["bool_values"];
	        this.is_coil = source["is_coil"];
	        this.tx_count = source["tx_count"];
	        this.err_count = source["err_count"];
	        this.latency_ms = source["latency_ms"];
	        this.error = source["error"];
	        this.raw_tx = source["raw_tx"];
	        this.raw_rx = source["raw_rx"];
	    }
	}
	export class RegisterScanItem {
	    address: number;
	    valid: boolean;
	    value: number;
	    hex: string;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new RegisterScanItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.valid = source["valid"];
	        this.value = source["value"];
	        this.hex = source["hex"];
	        this.detail = source["detail"];
	    }
	}
	export class SerialPortDetail {
	    port_name: string;
	    description?: string;
	    hardware_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new SerialPortDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port_name = source["port_name"];
	        this.description = source["description"];
	        this.hardware_id = source["hardware_id"];
	    }
	}
	export class SimulationConfig {
	    session_id: string;
	    table: string;
	    address: number;
	    mode: string;
	    min: number;
	    max: number;
	    step: number;
	    interval_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new SimulationConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.table = source["table"];
	        this.address = source["address"];
	        this.mode = source["mode"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.step = source["step"];
	        this.interval_ms = source["interval_ms"];
	    }
	}
	export class SlaveConfig {
	    type: string;
	    host?: string;
	    port_tcp?: number;
	    port?: string;
	    baud_rate?: number;
	    data_bits?: number;
	    parity?: string;
	    stop_bits?: number;
	    slave_id: number;
	
	    static createFrom(source: any = {}) {
	        return new SlaveConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.host = source["host"];
	        this.port_tcp = source["port_tcp"];
	        this.port = source["port"];
	        this.baud_rate = source["baud_rate"];
	        this.data_bits = source["data_bits"];
	        this.parity = source["parity"];
	        this.stop_bits = source["stop_bits"];
	        this.slave_id = source["slave_id"];
	    }
	}
	export class SlaveMemorySlice {
	    session_id: string;
	    table: string;
	    start_address: number;
	    quantity: number;
	    values?: number[];
	    bool_values?: boolean[];
	
	    static createFrom(source: any = {}) {
	        return new SlaveMemorySlice(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.table = source["table"];
	        this.start_address = source["start_address"];
	        this.quantity = source["quantity"];
	        this.values = source["values"];
	        this.bool_values = source["bool_values"];
	    }
	}
	export class SlaveScanItem {
	    slave_id: number;
	    status: string;
	    detail: string;
	    latency_ms: number;
	    raw_rx?: string;
	
	    static createFrom(source: any = {}) {
	        return new SlaveScanItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slave_id = source["slave_id"];
	        this.status = source["status"];
	        this.detail = source["detail"];
	        this.latency_ms = source["latency_ms"];
	        this.raw_rx = source["raw_rx"];
	    }
	}
	export class WriteCoilParam {
	    slave_id: number;
	    address: number;
	    value: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WriteCoilParam(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slave_id = source["slave_id"];
	        this.address = source["address"];
	        this.value = source["value"];
	    }
	}
	export class WriteRegisterParam {
	    slave_id: number;
	    address: number;
	    value: number;
	
	    static createFrom(source: any = {}) {
	        return new WriteRegisterParam(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slave_id = source["slave_id"];
	        this.address = source["address"];
	        this.value = source["value"];
	    }
	}
	export class WriteRegistersParam {
	    slave_id: number;
	    address: number;
	    values: number[];
	
	    static createFrom(source: any = {}) {
	        return new WriteRegistersParam(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slave_id = source["slave_id"];
	        this.address = source["address"];
	        this.values = source["values"];
	    }
	}

}

export namespace sniffer {
	
	export class DeviceBaseline {
	    unit_id: number;
	    sample_count: number;
	    median_poll_interval_ms: number;
	    p50_latency_us: number;
	    p95_latency_us: number;
	    observed_function_codes: number[];
	
	    static createFrom(source: any = {}) {
	        return new DeviceBaseline(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.unit_id = source["unit_id"];
	        this.sample_count = source["sample_count"];
	        this.median_poll_interval_ms = source["median_poll_interval_ms"];
	        this.p50_latency_us = source["p50_latency_us"];
	        this.p95_latency_us = source["p95_latency_us"];
	        this.observed_function_codes = source["observed_function_codes"];
	    }
	}
	export class BaselineProfile {
	    mode: string;
	    learned_at?: string;
	    sample_frames: number;
	    devices: Record<number, DeviceBaseline>;
	
	    static createFrom(source: any = {}) {
	        return new BaselineProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.learned_at = source["learned_at"];
	        this.sample_frames = source["sample_frames"];
	        this.devices = this.convertValues(source["devices"], DeviceBaseline, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CaptureConfig {
	    mode: string;
	    listen_host?: string;
	    listen_port?: number;
	    target_host?: string;
	    target_port?: number;
	    serial_port?: string;
	    baud_rate?: number;
	    data_bits?: number;
	    parity?: string;
	    stop_bits?: number;
	    interface_name?: string;
	    bpf_filter?: string;
	
	    static createFrom(source: any = {}) {
	        return new CaptureConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.listen_host = source["listen_host"];
	        this.listen_port = source["listen_port"];
	        this.target_host = source["target_host"];
	        this.target_port = source["target_port"];
	        this.serial_port = source["serial_port"];
	        this.baud_rate = source["baud_rate"];
	        this.data_bits = source["data_bits"];
	        this.parity = source["parity"];
	        this.stop_bits = source["stop_bits"];
	        this.interface_name = source["interface_name"];
	        this.bpf_filter = source["bpf_filter"];
	    }
	}
	export class DeviceDiff {
	    unit_id: number;
	    status: string;
	    health_score_a: number;
	    health_score_b: number;
	    score_delta: number;
	    requests_a: number;
	    requests_b: number;
	    success_rate_a: number;
	    success_rate_b: number;
	    success_rate_delta: number;
	    p95_latency_us_a: number;
	    p95_latency_us_b: number;
	    latency_delta_us: number;
	    remarks: string;
	
	    static createFrom(source: any = {}) {
	        return new DeviceDiff(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.unit_id = source["unit_id"];
	        this.status = source["status"];
	        this.health_score_a = source["health_score_a"];
	        this.health_score_b = source["health_score_b"];
	        this.score_delta = source["score_delta"];
	        this.requests_a = source["requests_a"];
	        this.requests_b = source["requests_b"];
	        this.success_rate_a = source["success_rate_a"];
	        this.success_rate_b = source["success_rate_b"];
	        this.success_rate_delta = source["success_rate_delta"];
	        this.p95_latency_us_a = source["p95_latency_us_a"];
	        this.p95_latency_us_b = source["p95_latency_us_b"];
	        this.latency_delta_us = source["latency_delta_us"];
	        this.remarks = source["remarks"];
	    }
	}
	export class CaptureDiffResult {
	    total_frames_a: number;
	    total_frames_b: number;
	    health_score_a: number;
	    health_score_b: number;
	    health_score_delta: number;
	    bus_state_a: string;
	    bus_state_b: string;
	    p95_latency_us_a: number;
	    p95_latency_us_b: number;
	    p95_delta_us: number;
	    error_rate_a: number;
	    error_rate_b: number;
	    error_rate_delta: number;
	    timeout_count_a: number;
	    timeout_count_b: number;
	    new_devices: number[];
	    missing_devices: number[];
	    regressed_devices: number[];
	    improved_devices: number[];
	    device_diffs: DeviceDiff[];
	    verdict: string;
	    summary: string;
	
	    static createFrom(source: any = {}) {
	        return new CaptureDiffResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_frames_a = source["total_frames_a"];
	        this.total_frames_b = source["total_frames_b"];
	        this.health_score_a = source["health_score_a"];
	        this.health_score_b = source["health_score_b"];
	        this.health_score_delta = source["health_score_delta"];
	        this.bus_state_a = source["bus_state_a"];
	        this.bus_state_b = source["bus_state_b"];
	        this.p95_latency_us_a = source["p95_latency_us_a"];
	        this.p95_latency_us_b = source["p95_latency_us_b"];
	        this.p95_delta_us = source["p95_delta_us"];
	        this.error_rate_a = source["error_rate_a"];
	        this.error_rate_b = source["error_rate_b"];
	        this.error_rate_delta = source["error_rate_delta"];
	        this.timeout_count_a = source["timeout_count_a"];
	        this.timeout_count_b = source["timeout_count_b"];
	        this.new_devices = source["new_devices"];
	        this.missing_devices = source["missing_devices"];
	        this.regressed_devices = source["regressed_devices"];
	        this.improved_devices = source["improved_devices"];
	        this.device_diffs = this.convertValues(source["device_diffs"], DeviceDiff);
	        this.verdict = source["verdict"];
	        this.summary = source["summary"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TCPStreamStats {
	    packets: number;
	    retransmissions: number;
	    out_of_order: number;
	    gaps: number;
	    resets: number;
	    flows: number;
	
	    static createFrom(source: any = {}) {
	        return new TCPStreamStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.packets = source["packets"];
	        this.retransmissions = source["retransmissions"];
	        this.out_of_order = source["out_of_order"];
	        this.gaps = source["gaps"];
	        this.resets = source["resets"];
	        this.flows = source["flows"];
	    }
	}
	export class CaptureStatus {
	    running: boolean;
	    mode: string;
	    started_at?: string;
	    listen_address?: string;
	    target_address?: string;
	    active_connections: number;
	    bytes_captured: number;
	    dropped_chunks: number;
	    dropped_frames: number;
	    tcp?: TCPStreamStats;
	    last_error?: string;
	
	    static createFrom(source: any = {}) {
	        return new CaptureStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.mode = source["mode"];
	        this.started_at = source["started_at"];
	        this.listen_address = source["listen_address"];
	        this.target_address = source["target_address"];
	        this.active_connections = source["active_connections"];
	        this.bytes_captured = source["bytes_captured"];
	        this.dropped_chunks = source["dropped_chunks"];
	        this.dropped_frames = source["dropped_frames"];
	        this.tcp = this.convertValues(source["tcp"], TCPStreamStats);
	        this.last_error = source["last_error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DiagnosticItem {
	    rule_id: string;
	    severity: string;
	    scope?: string;
	    message: string;
	    recommendation?: string;
	    confidence: number;
	
	    static createFrom(source: any = {}) {
	        return new DiagnosticItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rule_id = source["rule_id"];
	        this.severity = source["severity"];
	        this.scope = source["scope"];
	        this.message = source["message"];
	        this.recommendation = source["recommendation"];
	        this.confidence = source["confidence"];
	    }
	}
	export class EngineeringValue {
	    address: number;
	    name: string;
	    value: string;
	    numeric_value: number;
	    unit: string;
	
	    static createFrom(source: any = {}) {
	        return new EngineeringValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.name = source["name"];
	        this.value = source["value"];
	        this.numeric_value = source["numeric_value"];
	        this.unit = source["unit"];
	    }
	}
	export class DecodedModbus {
	    unit_id: number;
	    transaction_id?: number;
	    function_code: number;
	    function_name: string;
	    kind: string;
	    address?: number;
	    quantity?: number;
	    values?: number[];
	    bits?: boolean[];
	    exception_code?: number;
	    exception_name?: string;
	    crc_valid?: boolean;
	    mbap_valid?: boolean;
	    summary: string;
	    sub_function?: number;
	    write_address?: number;
	    write_quantity?: number;
	    write_values?: number[];
	    and_mask?: number;
	    or_mask?: number;
	    text_data?: string;
	    engineering_values?: EngineeringValue[];
	
	    static createFrom(source: any = {}) {
	        return new DecodedModbus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.unit_id = source["unit_id"];
	        this.transaction_id = source["transaction_id"];
	        this.function_code = source["function_code"];
	        this.function_name = source["function_name"];
	        this.kind = source["kind"];
	        this.address = source["address"];
	        this.quantity = source["quantity"];
	        this.values = source["values"];
	        this.bits = source["bits"];
	        this.exception_code = source["exception_code"];
	        this.exception_name = source["exception_name"];
	        this.crc_valid = source["crc_valid"];
	        this.mbap_valid = source["mbap_valid"];
	        this.summary = source["summary"];
	        this.sub_function = source["sub_function"];
	        this.write_address = source["write_address"];
	        this.write_quantity = source["write_quantity"];
	        this.write_values = source["write_values"];
	        this.and_mask = source["and_mask"];
	        this.or_mask = source["or_mask"];
	        this.text_data = source["text_data"];
	        this.engineering_values = this.convertValues(source["engineering_values"], EngineeringValue);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CapturedFrame {
	    id: string;
	    sequence: number;
	    captured_at_unix_ns: number;
	    timestamp: string;
	    source_id: string;
	    transport: string;
	    direction: string;
	    capture_source: string;
	    capture_quality: string;
	    raw: number[];
	    hex: string;
	    parsed?: DecodedModbus;
	    conversation_id?: string;
	    response_time_us?: number;
	    diagnostics?: DiagnosticItem[];
	
	    static createFrom(source: any = {}) {
	        return new CapturedFrame(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sequence = source["sequence"];
	        this.captured_at_unix_ns = source["captured_at_unix_ns"];
	        this.timestamp = source["timestamp"];
	        this.source_id = source["source_id"];
	        this.transport = source["transport"];
	        this.direction = source["direction"];
	        this.capture_source = source["capture_source"];
	        this.capture_quality = source["capture_quality"];
	        this.raw = source["raw"];
	        this.hex = source["hex"];
	        this.parsed = this.convertValues(source["parsed"], DecodedModbus);
	        this.conversation_id = source["conversation_id"];
	        this.response_time_us = source["response_time_us"];
	        this.diagnostics = this.convertValues(source["diagnostics"], DiagnosticItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class DeviceHealth {
	    unit_id: number;
	    state: string;
	    requests: number;
	    responses: number;
	    exceptions: number;
	    timeouts: number;
	    retries: number;
	    success_rate: number;
	    average_latency_us: number;
	    p95_latency_us: number;
	    last_request_at?: string;
	    last_response_at?: string;
	
	    static createFrom(source: any = {}) {
	        return new DeviceHealth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.unit_id = source["unit_id"];
	        this.state = source["state"];
	        this.requests = source["requests"];
	        this.responses = source["responses"];
	        this.exceptions = source["exceptions"];
	        this.timeouts = source["timeouts"];
	        this.retries = source["retries"];
	        this.success_rate = source["success_rate"];
	        this.average_latency_us = source["average_latency_us"];
	        this.p95_latency_us = source["p95_latency_us"];
	        this.last_request_at = source["last_request_at"];
	        this.last_response_at = source["last_response_at"];
	    }
	}
	export class ProfileRegister {
	    address: number;
	    name: string;
	    data_type: string;
	    scale: number;
	    unit: string;
	    description?: string;
	    table?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileRegister(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.name = source["name"];
	        this.data_type = source["data_type"];
	        this.scale = source["scale"];
	        this.unit = source["unit"];
	        this.description = source["description"];
	        this.table = source["table"];
	    }
	}
	export class DeviceProfile {
	    unit_id: number;
	    device_name: string;
	    model?: string;
	    registers: ProfileRegister[];
	
	    static createFrom(source: any = {}) {
	        return new DeviceProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.unit_id = source["unit_id"];
	        this.device_name = source["device_name"];
	        this.model = source["model"];
	        this.registers = this.convertValues(source["registers"], ProfileRegister);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class HealthSnapshot {
	    score: number;
	    state: string;
	    total_frames: number;
	    requests: number;
	    responses: number;
	    exceptions: number;
	    timeouts: number;
	    retries: number;
	    malformed_frames: number;
	    crc_error_frames: number;
	    orphan_responses: number;
	    pending_requests: number;
	    average_latency_us: number;
	    p95_latency_us: number;
	    devices: DeviceHealth[];
	
	    static createFrom(source: any = {}) {
	        return new HealthSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.score = source["score"];
	        this.state = source["state"];
	        this.total_frames = source["total_frames"];
	        this.requests = source["requests"];
	        this.responses = source["responses"];
	        this.exceptions = source["exceptions"];
	        this.timeouts = source["timeouts"];
	        this.retries = source["retries"];
	        this.malformed_frames = source["malformed_frames"];
	        this.crc_error_frames = source["crc_error_frames"];
	        this.orphan_responses = source["orphan_responses"];
	        this.pending_requests = source["pending_requests"];
	        this.average_latency_us = source["average_latency_us"];
	        this.p95_latency_us = source["p95_latency_us"];
	        this.devices = this.convertValues(source["devices"], DeviceHealth);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NetworkInterfaceInfo {
	    index: number;
	    name: string;
	    description?: string;
	    hardware_addr: string;
	    ips: string[];
	    is_up: boolean;
	    is_loopback: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NetworkInterfaceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.hardware_addr = source["hardware_addr"];
	        this.ips = source["ips"];
	        this.is_up = source["is_up"];
	        this.is_loopback = source["is_loopback"];
	    }
	}
	export class NpcapStatus {
	    installed: boolean;
	    version: string;
	    driver_path?: string;
	    interfaces: NetworkInterfaceInfo[];
	    download_url: string;
	    instructions: string;
	
	    static createFrom(source: any = {}) {
	        return new NpcapStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.version = source["version"];
	        this.driver_path = source["driver_path"];
	        this.interfaces = this.convertValues(source["interfaces"], NetworkInterfaceInfo);
	        this.download_url = source["download_url"];
	        this.instructions = source["instructions"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProfileCatalog {
	    name: string;
	    version: string;
	    devices: Record<number, DeviceProfile>;
	
	    static createFrom(source: any = {}) {
	        return new ProfileCatalog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.devices = this.convertValues(source["devices"], DeviceProfile, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ShiftReportOptions {
	    title: string;
	    operator: string;
	    shift: string;
	    notes: string;
	
	    static createFrom(source: any = {}) {
	        return new ShiftReportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.operator = source["operator"];
	        this.shift = source["shift"];
	        this.notes = source["notes"];
	    }
	}
	export class Snapshot {
	    generated_at: string;
	    frames: CapturedFrame[];
	    health: HealthSnapshot;
	    baseline: BaselineProfile;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generated_at = source["generated_at"];
	        this.frames = this.convertValues(source["frames"], CapturedFrame);
	        this.health = this.convertValues(source["health"], HealthSnapshot);
	        this.baseline = this.convertValues(source["baseline"], BaselineProfile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace web {
	
	export class NetworkInterfaceInfo {
	    name: string;
	    ip: string;
	    type: string;
	    description: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new NetworkInterfaceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.ip = source["ip"];
	        this.type = source["type"];
	        this.description = source["description"];
	        this.url = source["url"];
	    }
	}
	export class RemoteServerStatus {
	    is_running: boolean;
	    port: number;
	    allow_write: boolean;
	    active_clients: number;
	    token: string;
	    interfaces: NetworkInterfaceInfo[];
	
	    static createFrom(source: any = {}) {
	        return new RemoteServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.is_running = source["is_running"];
	        this.port = source["port"];
	        this.allow_write = source["allow_write"];
	        this.active_clients = source["active_clients"];
	        this.token = source["token"];
	        this.interfaces = this.convertValues(source["interfaces"], NetworkInterfaceInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

