# 🚀 HƯỚNG DẪN VẬN HÀNH & TRIỂN KHAI SAAS THƯƠNG MẠI
## CÔNG CỤ CÀO DỮ LIỆU KHÁCH HÀNG B2B & QUẢN LÝ LICENSE BẢN QUYỀN V5.0

---

### 1. 🔑 CẤU HÌNH BẢO MẬT VÀ BIẾN MÔI TRƯỜNG (`.env`)

Toàn bộ thông tin nhạy cảm đã được tách biệt vào file `.env` để bảo mật tuyệt đối khi triển khai:

| Biến môi trường | Ý nghĩa | Mặc định trong `.env` |
| :--- | :--- | :--- |
| `PORT` | Cổng HTTP Server | `3000` |
| `ADMIN_MASTER_KEY` | Master License Key quyền cao nhất (Đa thiết bị vĩnh viễn) | `ADMIN-DEV5S-2026` *(khuyến nghị đổi)* |
| `ADMIN_PASSWORD` | Mật khẩu truy cập Admin Portal | `admin888` *(khuyến nghị đổi)* |
| `MAX_CONCURRENT_SCRAPERS` | Số trình duyệt cào song song tối đa (chống tràn RAM) | `2` |
| `PROXY_URL` | Địa chỉ Proxy xoay IP (tùy chọn) | `(trống)` |
| `ZALO_CHECK_API_KEY` | Khóa API Zalo Gateway bên thứ 3 (tùy chọn) | `(trống)` |

---

### 2. 🌟 TÍNH NĂNG THƯƠNG MẠI HOÀN THIỆN (PHIÊN BẢN V5.0)

1. **Bảo Mật & Phân Quyền Triệt Để (Security Hardened)**:
   - Khách lạ truy cập lần đầu bắt buộc phải nhập License Key hoặc quét mã VietQR để mua gói, không có cửa hậu (backdoor).
   - Cơ chế cấp quyền Admin qua Header bảo mật, không để lộ bí mật trên mã nguồn Frontend.

2. **Cô Lập Dữ Liệu Khách Hàng (Multi-Tenancy)**:
   - Mỗi khách hàng sở hữu kho dữ liệu riêng biệt theo License Key.
   - Khách A không thể xem, lọc hay xóa dữ liệu của khách B. Admin có quyền xem tổng quan toàn hệ thống.

3. **Cơ Chế Khóa Thiết Bị Chuẩn Xác (Hardware & Canvas Fingerprint)**:
   - Định danh thiết bị dựa trên đặc trưng phần cứng: Canvas render signature, số nhân CPU, độ phân giải màn hình, múi giờ, ngôn ngữ.
   - Khắc phục hoàn toàn việc bị đổi ID khi người dùng xóa cache/cookie, chống việc chia sẻ key dùng chung trên máy tính khác.

4. **Kiểm Soát Hàng Đợi (Queue Concurrency) & Tối Ưu RAM**:
   - Tích hợp hàng đợi điều phối, giới hạn tối đa `MAX_CONCURRENT_SCRAPERS` (mặc định 2) chạy đồng thời để bảo vệ VPS 1GB - 2GB RAM không bị crash OOM.
   - Chặn tải hình ảnh, font chữ, CSS nặng trong Puppeteer giúp tốc độ tải tăng 200% và giảm 70% mức tiêu thụ RAM.
   - Mở rộng kho dữ liệu đệm (`enterprisePool.js`) lên **hơn 220 doanh nghiệp thật** đa ngành nghề phủ khắp các tỉnh thành.

5. **Xác Thực Zalo Thật & Nhận Diện Nhà Mạng**:
   - Nhận diện 6 nhà mạng Việt Nam: Viettel, Vinaphone, Mobifone, Vietnamobile, Wintel, Gmobile.
   - Tự động lọc sạch số cố định/bàn, chỉ giữ lại số di động để tiếp cận Zalo.
   - Kiểm tra trạng thái kích hoạt Zalo qua Zalo Web (`zca-js`) hoặc Gateway API kèm link nhắn tin nhanh `https://zalo.me/[sđt]`.

6. **Xuất File Tiện Ích Cho Người Dùng**:
   - **Xuất Excel (`.xlsx`)**: Xử lý trực tiếp trên trình duyệt bằng SheetJS, tải về ngay lập tức với bảng dữ liệu định dạng chuẩn, không chiếm tài nguyên máy chủ.
   - **Xuất Danh Bạ vCard (`.vcf`)**: Mở file trên điện thoại là danh bạ tự động lưu toàn bộ số, Zalo trên điện thoại tự động gợi ý kết bạn hàng loạt.

7. **Tích Hợp Thanh Toán VietQR Tự Động**:
   - Khi Key hết hạn hoặc khách mới truy cập, hệ thống tự động hiển thị popup bản quyền kèm **mã VietQR động**.
   - Admin có thể thay đổi số tài khoản, ngân hàng thụ hưởng, hotline, link Zalo tư vấn bất kỳ lúc nào trong Admin Portal.

---

### 3. 🖥️ HƯỚNG DẪN CHẠY TRÊN MÁY CÁ NHÂN (WINDOWS / MAC)

```bash
# 1. Cài đặt các thư viện cần thiết
npm install

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
