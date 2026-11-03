# 🚀 HƯỚNG DẪN VẬN HÀNH & TRIỂN KHAI SAAS THƯƠNG MẠI
## 5S DEV.TOOL - NỀN TẢNG SAAS QUÉT LEAD B2B & QUẢN TRỊ BẢN QUYỀN V5.5 PRO

---

### 1. 🔑 CẤU HÌNH BẢO MẬT VÀ BIẾN MÔI TRƯỜNG (`.env` / Vercel Environment Variables)

Toàn bộ thông tin nhạy cảm đã được tách biệt vào file `.env` (hoặc cài đặt trong mục **Environment Variables** trên Vercel):

| Biến môi trường | Ý nghĩa | Mặc định gợi ý |
| :--- | :--- | :--- |
| `PORT` | Cổng HTTP Server chạy Local/VPS | `3000` |
| `ADMIN_MASTER_KEY` | Master License Key quyền tối cao (Vĩnh viễn, đa thiết bị) | `ADMIN-DEV5S-2026` |
| `ADMIN_PASSWORD` | Mật khẩu truy cập Cổng Quản Trị Admin | `admin888` hoặc `admindev5s` |
| `GOOGLE_MAPS_API_KEY` | Khóa Google Maps Places API (New/Legacy) | *(Đã khóa ngầm bảo vệ)* |
| `MAX_CONCURRENT_SCRAPERS` | Số tiến trình cào song song tối đa (chống tràn RAM VPS) | `2` |
| `PROXY_URL` | Địa chỉ Proxy xoay IP khi quét tải lớn (tùy chọn) | `(trống)` |
| `ZALO_CHECK_API_KEY` | Khóa API Zalo Gateway bên thứ 3 (tùy chọn) | `(trống)` |

---

### 2. 🌟 TÍNH NĂNG V5.5 PRO HOÀN THIỆN ĐÃ TÍCH HỢP

1. **Quét Lead Đa Nguồn (Omni-Channel B2B)**:
   - Google Maps Places API (Places New v1 & Classic).
   - Facebook Fanpage Business & Group công khai.
   - Trang Vàng Doanh Nghiệp Việt Nam (TrangVangVietnam.com).
   - Cổng Thông Tin Doanh Nghiệp Quốc Gia (DoanhNghiep.biz).
   - Kho dữ liệu đệm >3.200 doanh nghiệp đối soát thực bao phủ 63/63 tỉnh thành & 24+ ngành nghề thực chiến.

2. **Kiểm Tra Zalo Chuẩn Xác (ACTIVE vs NOT FOUND)**:
   - Cơ chế 3 tầng: Cổng ngoài -> Phiên Web (`zca-js`) -> Bộ phân giải HLR Telecom Resolver tự động phân loại số điện thoại có Zalo hay chưa kích hoạt/số cố định.
   - Nhận diện nhà mạng Viettel, Vina, Mobi, Vietnamobile.

3. **Mini-CRM & Kịch Bản Nhắn Zalo Cá Nhân Hóa**:
   - Trực tiếp gắn nhãn tiến độ sale (Mới cào, Đã gọi, Đã nhắn Zalo, Quan tâm, Đã chốt, Không nghe máy) và ghi chú khách hàng.
   - Nút **Chat Zalo** tự động điền sẵn tên người đại diện, tên công ty và lời chào chuyên nghiệp.

4. **Quản Lý Bản Quyền Khóa Máy (Anti-Share)**:
   - Ghim cố định thiết bị bằng thuật toán Canvas + Hardware Fingerprint.
   - Khóa bản quyền theo gói: 1 Ngày, 1 Tháng, 3 Tháng, 1 Năm, 3 Năm, Vĩnh Viễn.
   - Tự động sinh mã VietQR Napas247 cho khách quét thanh toán chuyển khoản nhận key ngay.

---

### 3. ☁️ HƯỚNG DẪN TRIỂN KHAI LÊN VERCEL (VERCEL.APP)

1. **Đẩy mã nguồn lên GitHub**:
   - Repository: `https://github.com/ngoisaocodon2202/5stool.git` (nhánh `main`).
2. **Import vào Vercel**:
   - Vào [Vercel Dashboard](https://vercel.com/new).
   - Chọn repo `5stool` và bấm **Deploy**.
   - Cấu hình Framework Preset: **Other** (tự động nhận `vercel.json`).
   - Node.js Version: **22.x**.
3. **Thêm Environment Variables trên Vercel**:
   - `ADMIN_MASTER_KEY`: `ADMIN-DEV5S-2026`
   - `ADMIN_PASSWORD`: `admindev5s` (hoặc mật khẩu riêng của bạn)
   - `GOOGLE_MAPS_API_KEY`: `AIzaSyAjo3HeJcNqZJNO1ygb15u86aH68biE_eE`

---

### 4. 🖥️ CHẠY LOCAL TRÊN MÁY TÍNH

```bash
# 1. Cài đặt các thư viện cần thiết
npm install

# 2. Khởi chạy ứng dụng
npm start
# Hoặc: node server.js
```
Truy cập: `http://localhost:3000` (Giao diện Tool) hoặc `http://localhost:3000/admin` (Quản trị viên).

# 2. Khởi chạy máy chủ
node server.js

# 3. Mở trình duyệt truy cập:
http://localhost:3000
```

---

### 4. 🌐 HƯỚNG DẪN DEPLOY LÊN CLOUD / VPS (UBUNTU LINUX)

```bash
# Bước 1: Cài đặt Node.js 20+ và Google Chrome trên VPS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt --fix-broken install -y
sudo npm install -g pm2

# Bước 2: Tải code lên VPS, tạo file .env
cd /var/www/lead-tool
cp .env.example .env
nano .env   # Điền mật khẩu Admin và Master Key riêng của bạn
npm install --omit=dev

# Bước 3: Chạy ứng dụng bằng PM2
pm2 start server.js --name "lead-saas"
pm2 startup
pm2 save
```
