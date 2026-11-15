// Seed catalog. Prices are integer satang (฿1 = 100 satang). Fictional brands/models for coursework.
export interface SeedCategory { slug: string; name: string; description: string; sortOrder: number }
export interface SeedProduct { sku: string; name: string; brand: string; category: string; priceSatang: number; stock: number; description: string; specs: string[] }

export const categories: SeedCategory[] = [
  { slug: 'keyboards', name: 'Keyboards', description: 'Mechanical, wireless and compact keyboards', sortOrder: 1 },
  { slug: 'mice', name: 'Mice', description: 'Gaming, ergonomic and travel mice', sortOrder: 2 },
  { slug: 'headsets', name: 'Headsets & Audio', description: 'Headsets, earbuds and speakers', sortOrder: 3 },
  { slug: 'monitors', name: 'Monitors', description: 'Office, gaming and creator displays', sortOrder: 4 },
  { slug: 'webcams', name: 'Webcams & Mics', description: 'Streaming and video-call gear', sortOrder: 5 },
  { slug: 'storage', name: 'Storage', description: 'SSDs, flash drives and card readers', sortOrder: 6 },
  { slug: 'accessories', name: 'Accessories', description: 'Hubs, stands, pads and cables', sortOrder: 7 },
];

const p = (sku: string, name: string, brand: string, category: string, baht: number, stock: number, description: string, specs: string[]): SeedProduct =>
  ({ sku, name, brand, category, priceSatang: Math.round(baht * 100), stock, description, specs });

export const products: SeedProduct[] = [
  p('KB-MECH-TKL-01', 'TKL Mechanical Keyboard (Red Switch)', 'Keyforge', 'keyboards', 1890, 25, 'Tenkeyless mechanical keyboard with linear red switches and white backlight.', ['87 keys', 'Linear red switches', 'USB-C detachable cable']),
  p('KB-MECH-FULL-02', 'Full-Size Mechanical Keyboard (Brown Switch)', 'Keyforge', 'keyboards', 2290, 18, 'Full-size board with tactile brown switches and a dedicated media wheel.', ['104 keys', 'Tactile brown switches', 'Media wheel']),
  p('KB-WL-SLIM-03', 'Slim Wireless Keyboard', 'Nimbus', 'keyboards', 990, 40, 'Low-profile scissor-switch keyboard that pairs with three devices.', ['Bluetooth 5.1 + 2.4 GHz', '3-device switching', '12-month battery']),
  p('KB-75-HOT-04', '75% Hot-Swap Keyboard RGB', 'Keyforge', 'keyboards', 3290, 12, 'Gasket-mounted 75% board with hot-swappable sockets and per-key RGB.', ['Hot-swap sockets', 'Gasket mount', 'Per-key RGB']),
  p('KB-60-MINI-05', '60% Compact Gaming Keyboard', 'Vortexa', 'keyboards', 1590, 0, 'Compact 60% layout for more mouse space, with optical switches.', ['61 keys', 'Optical switches', 'Detachable cable']),
  p('MS-GAME-PRO-01', 'Pro Gaming Mouse 26K DPI', 'Vortexa', 'mice', 1790, 30, 'Lightweight wired gaming mouse with a 26,000 DPI optical sensor.', ['26,000 DPI', '63 g', '6 programmable buttons']),
  p('MS-WL-ERGO-02', 'Ergonomic Vertical Wireless Mouse', 'Nimbus', 'mice', 1290, 22, 'Vertical design that keeps the wrist in a natural handshake position.', ['57° vertical angle', 'Bluetooth + USB receiver', 'Rechargeable']),
  p('MS-TRAVEL-03', 'Silent Travel Mouse', 'Nimbus', 'mice', 490, 60, 'Compact wireless mouse with silent clicks for libraries and cafés.', ['Silent switches', 'AA battery', 'Nano receiver']),
  p('MS-WL-GAME-04', 'Wireless Gaming Mouse Lightspeed', 'Vortexa', 'mice', 2590, 14, 'Low-latency wireless gaming mouse with a 70-hour battery.', ['1 ms wireless', '70 h battery', '25,600 DPI']),
  p('MS-TRACK-05', 'Thumb Trackball Mouse', 'Orbit', 'mice', 1490, 9, 'Thumb-operated trackball that needs no desk movement.', ['34 mm ball', 'Bluetooth', '4 buttons']),
  p('HS-GAME-71-01', '7.1 Surround Gaming Headset', 'Vortexa', 'headsets', 1990, 20, 'Over-ear headset with virtual 7.1 surround and a detachable mic.', ['50 mm drivers', 'Virtual 7.1', 'USB + 3.5 mm']),
  p('HS-WL-ANC-02', 'Wireless ANC Headphones', 'Sonora', 'headsets', 3490, 16, 'Active noise cancelling headphones with 40-hour battery life.', ['Hybrid ANC', '40 h battery', 'Multipoint Bluetooth']),
  p('HS-EARBUD-03', 'True Wireless Earbuds', 'Sonora', 'headsets', 1290, 35, 'Compact earbuds with a charging case and touch controls.', ['Bluetooth 5.3', '28 h with case', 'IPX4']),
  p('HS-USB-OFFICE-04', 'USB Office Headset with Mic', 'Clearline', 'headsets', 790, 45, 'Lightweight headset for video calls with a noise-reducing boom mic.', ['USB-A', 'Inline mute', 'Noise-reducing mic']),
  p('SP-DESK-05', 'Desktop Speakers 2.0', 'Sonora', 'headsets', 1190, 0, 'Compact stereo speakers with a front headphone jack.', ['2 × 10 W', '3.5 mm + Bluetooth', 'Front volume knob']),
  p('MN-24-IPS-01', '24" IPS Monitor 100Hz', 'Lumina', 'monitors', 3290, 15, 'Full HD IPS monitor with slim bezels and eye-care modes.', ['1920 × 1080', '100 Hz', 'IPS, sRGB 99%']),
  p('MN-27-QHD-02', '27" QHD Gaming Monitor 165Hz', 'Lumina', 'monitors', 7990, 8, '27-inch QHD panel with 165 Hz refresh rate and 1 ms response.', ['2560 × 1440', '165 Hz', 'Adaptive sync']),
  p('MN-27-4K-03', '27" 4K Creator Monitor USB-C', 'Lumina', 'monitors', 11900, 5, 'Colour-accurate 4K display with 65 W USB-C power delivery.', ['3840 × 2160', 'USB-C 65 W', 'DCI-P3 95%']),
  p('MN-34-UW-04', '34" Ultrawide Curved Monitor', 'Lumina', 'monitors', 12900, 4, 'Curved 21:9 ultrawide for multitasking and immersive games.', ['3440 × 1440', '1500R curve', '144 Hz']),
  p('MN-16-PORT-05', '15.6" Portable USB-C Monitor', 'Lumina', 'monitors', 3990, 11, 'Slim portable display powered by a single USB-C cable.', ['1920 × 1080', 'USB-C + mini HDMI', 'Smart cover stand']),
  p('WC-1080-01', '1080p Webcam with Privacy Shutter', 'Clearline', 'webcams', 990, 28, 'Full HD webcam with autofocus, dual mics and a privacy shutter.', ['1080p 30 fps', 'Autofocus', 'Privacy shutter']),
  p('WC-4K-02', '4K Streaming Webcam', 'Clearline', 'webcams', 3290, 7, '4K webcam with HDR and auto framing for streaming.', ['4K 30 fps / 1080p 60 fps', 'HDR', 'Auto framing']),
  p('MC-USB-COND-03', 'USB Condenser Microphone', 'Sonora', 'webcams', 1890, 13, 'Cardioid USB condenser mic for podcasts and streaming.', ['Cardioid', '24-bit/96 kHz', 'Zero-latency monitoring']),
  p('MC-LAV-04', 'Wireless Lavalier Mic Kit', 'Sonora', 'webcams', 1490, 10, 'Clip-on wireless microphones for phones and cameras.', ['2 transmitters', 'USB-C + Lightning', '8 h battery']),
  p('LT-RING-05', '10" LED Ring Light with Stand', 'Clearline', 'webcams', 690, 24, 'Dimmable ring light for video calls with adjustable colour temperature.', ['3 colour modes', '10 brightness levels', 'Tripod stand']),
  p('SSD-NVME-1TB-01', '1TB NVMe Gen4 SSD', 'Datacore', 'storage', 2490, 26, 'High-speed M.2 NVMe SSD for laptops and desktops.', ['1 TB', 'Up to 7,000 MB/s read', 'M.2 2280']),
  p('SSD-PORT-1TB-02', '1TB Portable SSD USB-C', 'Datacore', 'storage', 2990, 19, 'Pocket-sized external SSD with USB 3.2 Gen 2 speeds.', ['1 TB', '1,050 MB/s', 'Drop resistant']),
  p('USB-64-03', '64GB USB 3.2 Flash Drive', 'Datacore', 'storage', 290, 80, 'Metal-body flash drive with a key-ring loop.', ['64 GB', 'USB 3.2 Gen 1', 'Metal body']),
  p('SD-128-04', '128GB microSD Card with Adapter', 'Datacore', 'storage', 390, 50, 'A2/V30 microSD card for cameras, drones and handhelds.', ['128 GB', 'A2, V30', 'SD adapter included']),
  p('CR-USBC-05', 'USB-C SD/microSD Card Reader', 'Linkwave', 'storage', 350, 33, 'Dual-slot card reader with simultaneous read.', ['SD + microSD', 'USB-C', 'UHS-I']),
  p('HUB-USBC-7-01', '7-in-1 USB-C Hub', 'Linkwave', 'accessories', 1290, 27, 'USB-C hub with HDMI 4K, USB-A, SD and 100 W pass-through.', ['HDMI 4K 60 Hz', '100 W PD', '3 × USB-A']),
  p('PAD-XL-02', 'XL Desk Mouse Pad', 'Vortexa', 'accessories', 390, 55, 'Extended cloth desk mat with stitched edges.', ['900 × 400 mm', 'Non-slip base', 'Stitched edges']),
  p('STAND-LAP-03', 'Aluminium Laptop Stand', 'Orbit', 'accessories', 890, 21, 'Adjustable laptop stand that raises the screen to eye level.', ['6 height levels', 'Fits 10–17"', 'Foldable']),
  p('ARM-MON-04', 'Single Monitor Arm (Gas Spring)', 'Orbit', 'accessories', 1590, 9, 'Gas-spring arm for monitors up to 32 inches.', ['Up to 9 kg', 'VESA 75/100', 'Cable management']),
  p('CBL-USBC-2M-05', 'USB-C to USB-C Cable 2m (100W)', 'Linkwave', 'accessories', 290, 70, 'Braided cable for 100 W charging and data.', ['2 m', '100 W PD', 'USB 2.0 data']),
  p('KVM-2PORT-06', '2-Port USB KVM Switch', 'Linkwave', 'accessories', 990, 0, 'Share one keyboard, mouse and monitor between two computers.', ['2 PCs', 'HDMI 4K', 'Button switching']),
];
