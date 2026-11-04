# BÁO CÁO KỸ THUẬT & GIẢI ĐÁP BÀI TOÁN QUÉT DỮ LIỆU LEAD B2B
**Hệ Thống:** 5S DEV.TOOL - SaaS B2B Lead Extraction & Zalo Verification  
**Chủ đề:** Tối ưu bài toán quét 5.000 khách sạn tại Hải Phòng, cơ chế chống trùng lặp, từ khóa tùy biến & an toàn API  

---

## 🎯 BÀI TOÁN ĐẶT RA
> *"Giả sử tìm khách sạn tại Hải Phòng có khoảng 5.000 khách sạn chia đều cho các quận/huyện, phường/xã. Nếu mỗi lần tìm được 200 khách sạn thì:  
> 1. Bao giờ mới tìm hết 5.000 khách sạn?  
> 2. Làm sao để tìm không bị trùng lặp khách sạn?  
> 3. Có thể thêm chức năng tìm kiếm theo từ khóa mong muốn không?  
> 4. Việc tìm này có ảnh hưởng tới App hoặc API không? Có giới hạn hay rủi ro gì không?"*

---

## 📋 GIẢI ĐÁP CHI TIẾT DỰA TRÊN KIẾN TRÚC TOOL HIỆN TẠI

### Câu 1: Bao giờ mới tìm hết 5.000 khách sạn?

#### 1. Cơ chế của các nền tảng dữ liệu (Google Maps, Trang Vàng, Cổng DN)
* **Quy tắc trần kết quả (Search Cap):** Bất kỳ công cụ tìm kiếm nào (đặc biệt là Google Maps Places API) đều khống chế **tối đa 60 đến 100 kết quả** cho một câu truy vấn tìm kiếm đơn lẻ (ví dụ gõ: *"khách sạn tại Hải Phòng"*). Google sẽ ưu tiên trả về các địa điểm nổi bật nhất tại khu vực trung tâm, không trả một lúc 5.000 kết quả để tối ưu băng thông.
* Do đó, nếu chỉ bấm tìm duy nhất một cụm từ *"khách sạn tại Hải Phòng"*, dù bấm 100 lần thì kết quả trả về cũng chỉ xoay quanh cụm 60-100 địa điểm quen thuộc.

#### 2. Giải pháp kỹ thuật của Tool để lấy trọn vẹn 5.000 khách sạn
* **Chiến thuật "Chia nhỏ lưới địa lý" (Subdivision / Geo-Grid Scanning):**
  * Hải Phòng có **15 quận/huyện** (Lê Chân, Ngô Quyền, Hồng Bàng, Hải An, Đồ Sơn, Cát Hải, Thủy Nguyên, An Dương...) và hơn **217 phường/xã**.
  * Để vét cạn toàn bộ 5.000 khách sạn, người dùng/hệ thống chia câu truy vấn theo từng cụm khu vực:
    * Mẻ 1: *"Khách sạn Đồ Sơn"* -> Lấy toàn bộ ~150 khách sạn khu vực Đồ Sơn.
    * Mẻ 2: *"Khách sạn Cát Bà"* hoặc *"Khách sạn Cát Hải"* -> Lấy toàn bộ khách sạn du lịch biển đảo.
    * Mẻ 3: *"Khách sạn Lê Chân"*, *"Khách sạn Ngô Quyền"*, *"Khách sạn Thủy Nguyên"*...
  * Mỗi phường/xã hoặc quận/huyện thường chỉ có từ 30 đến 150 khách sạn, hoàn toàn nằm trong ngưỡng thu thập trọn vẹn của 1 mẻ quét (200 leads/lần).

#### 3. Dấu hiệu nhận biết khi nào đã QUÉT HẾT (Vét cạn dữ liệu):
* Hệ thống có bộ đếm đối soát thời gian thực:
  * Khi quét một khu vực mà hệ thống báo: **"Số lượng lead mới: 0"** (hoặc 100% kết quả trả về bị hệ thống loại bỏ vì đã tồn tại trong Database), điều đó xác nhận khu vực đó **đã được vét sạch hoàn toàn**.
  * Bảng thống kê tổng hiển thị con số tích lũy: Ví dụ kho đã chạm mốc 4.800 - 5.000 leads Hải Phòng và không còn số điện thoại mới phát sinh.

---

### Câu 2: Làm sao để tìm KHÔNG bị trùng lặp khách sạn?

Hệ thống đã được thiết kế sẵn **3 Lớp Phòng Thủ Chống Trùng Lặp (3-Tier Anti-Duplicate)** chạy tự động 100%:

```
[Kết quả mới cào về]
         │
         ▼
[LỚP 1: Lọc thời gian thực trong lúc cào (Memory Set Filter)]
   ├── Kiểm tra SĐT đã có trong DB của User chưa? (existingDbPhones)
   ├── Kiểm tra SĐT đã xuất hiện trong phiên cào hiện tại chưa? (seenSessionPhones)
   └── NẾU TRÙNG ➔ LOẠI BỎ NGAY LẬP TỨC (Không tốn hạn mức, không ghi đè)
         │
         ▼
[LỚP 2: Ràng buộc tính duy nhất tại Database (SQLite Unique & Tenant Isolation)]
   ├── Chuẩn hóa đầu số (+84 / 84 / 0x về đầu 0 tiêu chuẩn)
   └── Dữ liệu mỗi tài khoản được cô lập độc lập (Tenant Key), không bị xung đột
         │
         ▼
[LỚP 3: Nút bấm Khử Trùng Lặp 1-Click trên giao diện]
   └── Cho phép User rà soát, loại bỏ bản ghi trùng lặp chỉ với 1 cú click chuột
```

* **Kết quả:** Dù bạn có bấm nút "Bắt đầu cào data" 50 lần cùng một từ khóa hay cùng một tỉnh thành, những khách sạn nào đã được lưu vào danh sách trước đó sẽ **không bao giờ bị lưu trùng lặp lại lần thứ hai**.

---

### Câu 3: Có thể thêm chức năng tìm kiếm theo từ khóa mong muốn không?

👉 **TÌNH TRẠNG HIỆN TẠI: TOOL ĐÃ CÓ SẴN CHỨC NĂNG NÀY 100%!**

* **Cơ chế đã tích hợp:**
  1. Trên thanh công cụ, tại mục **"Ngành Nghề Kinh Doanh"**: Ngoài 24 nhóm ngành gợi ý sẵn (Bất động sản, Khách sạn, Spa, Xây dựng...), khách hàng có thể **gõ trực tiếp bất kỳ từ khóa chuyên sâu nào** vào ô tìm kiếm:
     * Ví dụ: Gõ *"Khách sạn 3 sao"*, *"Homestay Cát Bà"*, *"Khách sạn view biển"*, *"Resort nghỉ dưỡng"*, *"Nhà nghỉ bình dân"*...
     * Nhấn phím **Enter** hoặc bấm nút **"Chọn"**.
  2. Lõi xử lý phía Backend (`scraper.js`) sẽ tiếp nhận chính xác chuỗi từ khóa này và gửi truy vấn thẳng sang Google Maps Places API (`places.searchText`), Trang Vàng và Cổng Doanh Nghiệp Quốc Gia để bóc tách đúng ngách khách hàng mong muốn.

---

### Câu 4: Việc tìm này có ảnh hưởng tới App hoặc API không? Có giới hạn hay vấn đề gì không?

#### 1. Về Google Maps Places API (Chi phí & Giới hạn):
* **Hạn mức Google tặng miễn phí:** Mỗi tài khoản Google Cloud được tặng sẵn **200 USD miễn phí mỗi tháng** (tương đương ~5.000.000đ credit).
* **Bài toán chi phí thực tế:**
  * Giá API Google Places (New Text Search): khoảng **0.032$ / 1 lượt gọi** (mỗi lượt lấy về tối đa 20 địa điểm có đầy đủ Tên, SĐT, Địa chỉ, Đánh giá sao).
  * Để quét 5.000 khách sạn: Cần khoảng 250 lượt gọi API -> Tổng chi phí chỉ khoảng **~8$ - 9$ (khoảng 200.000đ)**. Con số này nằm trọn vẹn trong khoản 200$ miễn phí mỗi tháng của Google.
* **Cơ chế dự phòng an toàn (Hybrid Failover):**
  * Trong trường hợp API Google Maps hết hạn mức hoặc chưa cấu hình Billing, hệ thống **không bao giờ bị dừng hoạt động** mà tự động chuyển sang **3 nguồn dự phòng miễn phí 100%**:
    1. Trang Vàng Doanh Nghiệp Việt Nam (YellowPages)
    2. Cổng Thông Tin Đăng Ký Doanh Nghiệp Quốc Gia
    3. Kho dữ liệu Doanh nghiệp Pool 63 tỉnh thành tích hợp sẵn.

#### 2. Về Hiệu năng & Tốc độ của Web App:
* **Không làm đơ/lag server:** Tool đã có cơ chế **Scraper Rate Limiter** khống chế tối đa 2 tiến trình cào đồng thời, giải phóng RAM ngay sau khi hoàn thành.
* **Thời gian phản hồi nhanh:** Mỗi mẻ cào từ 50 - 200 leads chỉ mất từ **5 đến 15 giây**, hoàn toàn an toàn và nằm gọn trong giới hạn xử lý của hạ tầng Cloud (Vercel Serverless / Node.js).
* **Bảo vệ tài nguyên bằng Hạn Mức Bản Quyền (License Quota):** Mỗi khách hàng được quy định số lượt quét tối đa trong ngày (ví dụ 6.000 leads/ngày), ngăn chặn hành vi spam liên tục làm quá tải máy chủ.

---

## 🚀 KẾ HOẠCH NÂNG CẤP ĐỀ XUẤT (IMPLEMENTATION PLAN)
*(Đề xuất bổ sung để trải nghiệm của khách hàng trực quan và tiện lợi hơn nữa)*

| Hạng mục nâng cấp | Mô tả chi tiết | Thời gian thực hiện | Lợi ích mang lại |
| :--- | :--- | :--- | :--- |
| **1. Ô Nhập Từ Khóa Độc Lập** *(Standalone Keyword Input)* | Tách riêng ô nhập từ khóa tự do ra ngoài thanh điều khiển chính (bên cạnh ô Tỉnh thành) thay vì nằm bên trong menu dropdown ngành. | 15 - 30 phút | Khách hàng nhìn thấy ngay ô gõ từ khóa mong muốn mà không cần mở dropdown. |
| **2. Bổ sung Bộ lọc Cấp Quận/Huyện** *(District Filter)* | Khi chọn tỉnh thành (VD: Hải Phòng), hệ thống tự động tải danh sách các Quận/Huyện (Lê Chân, Đồ Sơn, Cát Bà...). | 30 - 45 phút | Hỗ trợ cào vét cạn tệp 5.000 khách sạn một cách có hệ thống theo từng khu vực. |
| **3. Thanh cảnh báo độ phủ tệp** *(Coverage Progress)* | Hiển thị % dữ liệu mới thu thập được sau mỗi lần quét (VD: "95% dữ liệu mới" -> khi còn "0% mới" thì báo đã quét hết). | 20 phút | Giúp khách hàng biết chính xác khi nào đã vét cạn toàn bộ data của khu vực đó. |

---

## 📌 KẾT LUẬN GỬI SẾP
1. **Tool hiện tại đã giải quyết triệt để vấn đề chống trùng lặp dữ liệu** bằng 3 lớp bảo vệ tự động.
2. **Khách hàng hoàn toàn có thể tự do gõ bất kỳ từ khóa nào** để tìm kiếm theo nhu cầu riêng.
3. **Quá trình quét hoàn toàn an toàn cho App và nằm trọn trong gói miễn phí của Google Maps**, có sẵn 3 nguồn dự phòng không lo gián đoạn.
4. **Đối với bài toán 5.000 khách sạn**, việc chia nhỏ cào theo từng cụm Quận/Huyện (hoặc áp dụng kế hoạch nâng cấp thêm ô lọc Quận/Huyện) là giải pháp tiêu chuẩn của các phần mềm MarTech hàng đầu hiện nay.

