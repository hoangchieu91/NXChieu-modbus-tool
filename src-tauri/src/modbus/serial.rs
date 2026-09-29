use crate::models::SerialPortDetail;
use serialport::SerialPortType;

pub fn list_ports() -> Vec<SerialPortDetail> {
    match serialport::available_ports() {
        Ok(ports) => ports
            .into_iter()
            .map(|p| {
                let description = match &p.port_type {
                    SerialPortType::UsbPort(usb) => {
                        let mut desc = String::new();
                        if let Some(prod) = &usb.product {
                            desc.push_str(prod);
                        }
                        if let Some(mfg) = &usb.manufacturer {
                            if !desc.is_empty() {
                                desc.push_str(" - ");
                            }
                            desc.push_str(mfg);
                        }
                        if desc.is_empty() {
                            Some("USB Serial Device".to_string())
                        } else {
                            Some(desc)
                        }
                    }
                    SerialPortType::PciPort => Some("PCI Serial Port".to_string()),
                    SerialPortType::BluetoothPort => Some("Bluetooth Serial Port".to_string()),
                    SerialPortType::Unknown => Some("Standard Serial Port".to_string()),
                };

                let hardware_id = match &p.port_type {
                    SerialPortType::UsbPort(usb) => {
                        Some(format!("VID:{:04X} PID:{:04X}", usb.vid, usb.pid))
                    }
                    _ => None,
                };

                SerialPortDetail {
                    port_name: p.port_name,
                    description,
                    hardware_id,
                }
            })
            .collect(),
        Err(e) => {
            log::warn!("Failed to enumerate serial ports: {}", e);
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_ports() {
        let ports = list_ports();
        println!("Found {} serial ports:", ports.len());
        for p in &ports {
            println!("  Port: {} | Desc: {:?}", p.port_name, p.description);
        }
    }
}
