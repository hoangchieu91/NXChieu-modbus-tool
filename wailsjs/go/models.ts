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

}

