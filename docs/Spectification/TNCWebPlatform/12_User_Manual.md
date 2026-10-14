# 12. Hướng dẫn sử dụng

## 12.1. Tổng quan

TNC Web Platform là web app (không cần cài đặt) cho hai nhóm người dùng chính
và một khu vực vận hành nội bộ:

| Vai trò | Khu vực sử dụng | Việc chính |
| ------- | --------------- | ---------- |
| Guest | Trang công khai | Xem catalog, tìm sản phẩm, xem tin đăng đã duyệt |
| Buyer | Tài khoản cá nhân | Mua hàng, nạp tiền, theo dõi đơn, mở tranh chấp |
| Seller | Tài khoản cá nhân | Đăng bán second-hand, quản lý tin, nhận tiền |
| Staff | Khu vực vận hành | Duyệt tin, cập nhật giao vận, xử lý release/refund, duyệt rút tiền |
| Admin | Khu vực vận hành + quản trị | Như staff + quản lý catalog, điều chỉnh sổ ngoại lệ, báo cáo |

> Lưu ý trạng thái: giao diện web **chưa được xây dựng** (⬜); hướng dẫn dưới
> đây đặc tả luồng sẽ hiện thực theo các chương 07 và 11. Khi UI hoàn thành,
> chương này là kịch bản kiểm thử và tài liệu đào tạo nhân viên.

## 12.2. Bắt đầu: tài khoản

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Mở trang chủ, bấm **Đăng ký** | Form đăng ký với email hoặc Google/Facebook |
| 2 | Điền email + mật khẩu (hoặc chọn OAuth) và xác nhận | Supabase Auth xác thực; tài khoản được tạo |
| 3 | Hệ thống tự tạo ví VND số dư 0 | Thấy mục **Ví** trong tài khoản |
| 4 | Cập nhật hồ sơ (tên hiển thị, số điện thoại) nếu cần | Hồ sơ hiển thị đúng ở đơn hàng |

- **Quên mật khẩu:** bấm "Quên mật khẩu" ở trang đăng nhập → nhận email đặt
  lại → đặt mật khẩu mới.
- **Đăng xuất:** menu tài khoản → Đăng xuất (xóa session trên máy).
- **Tài khoản bị khoá (hiếm):** vẫn xem được lịch sử nhưng không nạp/mua/rút
  được tiền; liên hệ hỗ trợ để được mở khoá.

## 12.3. Mua mỹ phẩm mới (B2C)

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Sản phẩm**, lọc theo danh mục/khoảng giá/tình trạng | Danh sách cập nhật, có phân trang "Tải thêm" |
| 2 | Mở chi tiết sản phẩm | Giá, tồn kho khả dụng, mô tả, ảnh; giá sale nếu đang flash sale |
| 3 | Bấm **Thêm vào giỏ** → mở giỏ | Sản phẩm trong giỏ với số lượng |
| 4 | Bấm **Thanh toán** | Trang checkout hiển thị tổng tiền (số do hệ thống tính) |
| 5 | Kiểm tra địa chỉ nhận hàng, chọn **Ví TNC** | Nút thanh toán khả dụng nếu số dư đủ |
| 6 | Bấm **Đặt hàng** | Đơn được tạo, tồn kho được giữ chỗ trong 10 phút (mặc định tạm) |
| 7 | Xác nhận thanh toán | Dialog "Đặt hàng thành công 🎉"; tiền vào escrow, đơn chờ giao |
| 8 | Theo dõi ở **Đơn hàng** | Timeline: Chờ giao → Đã gửi → Đã giao → Hoàn tất |

**Trường hợp đặc biệt**

- *Số dư không đủ:* hệ thống hiện thông báo và gợi ý **Nạp tiền** - đơn vẫn giữ
  chỗ đến khi hết hạn.
- *Quá 10 phút chưa thanh toán:* đơn tự hủy, tồn kho trả về; bạn tạo đơn mới.
- *Không muốn mua nữa:* mở đơn đang "Chờ thanh toán" → **Hủy đơn** (chỉ khi
  chưa trả tiền).

## 12.4. Mua mỹ phẩm second-hand (C2C) và cơ chế escrow

Khác biệt quan trọng: tiền của bạn **không** chuyển thẳng cho người bán. Tiền
được hệ thống giữ (escrow) cho đến khi bạn xác nhận đã nhận hàng, hoặc sau thời
gian khiếu nại (mặc định đề xuất 3 ngày - sẽ công bố chính thức).

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Mở listing có badge **Đã kiểm duyệt** | Xem % đã dùng, hạn dùng còn lại, ảnh chứng minh mua hàng |
| 2 | Bấm **Mua an toàn** | Đơn giữ chỗ (mỗi món chỉ 1 người mua được) |
| 3 | Thanh toán bằng ví | Tiền vào escrow; đơn "Đã thanh toán"; listing ẩn khỏi chợ |
| 4 | Nhận hàng từ người bán | Kiểm tra hàng đúng mô tả |
| 5a | Hàng đúng: bấm **Tôi đã nhận hàng** | Đơn chuyển "Đã giao"; escrow được giải phóng cho người bán (trừ hoa hồng) |
| 5b | Hàng sai/vấn đề: bấm **Báo vấn đề** (trong thời hạn) | Đơn chuyển "Tranh chấp"; tiền vẫn trong escrow; nhân viên liên hệ xử lý |
| 6 | Xem kết quả ở **Đơn hàng** | Hoàn tất (đã trả người bán) hoặc Hoàn tiền (tiền về ví bạn) |

**Quyền lợi của bạn**

- Người bán chỉ nhận tiền khi đơn được xác nhận giao thành công.
- Nếu không nhận được hàng, tiền được hoàn về ví.
- Người bán cũng được bảo vệ: người mua không thể "hoàn tiền tùy tiện" sau khi
  đã xác nhận - tranh chấp phải qua nhân viên xử lý có bằng chứng.

## 12.5. Ví: nạp tiền và xem sổ giao dịch

### Nạp tiền

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Ví** → **Nạp tiền** | Chọn mệnh giá hoặc nhập số tiền |
| 2 | Bấm **Tạo mã nạp** | Hiển thị QR + nội dung chuyển khoản + đếm ngược |
| 3 | Mở app ngân hàng, quét QR, chuyển **đúng số tiền và nội dung** | Ngân hàng thông báo giao dịch thành công |
| 4 | Quay lại trang Ví | Trong vài giây hệ thống cộng tiền; số dư cập nhật |

- Chuyển sai nội dung/số tiền: tiền chưa tự động vào ví - liên hệ hỗ trợ kèm
  ảnh biên lai để đối soát.
- Nạp tiền **không mất phí** (chính sách có thể điều chỉnh, sẽ công bố trước).

### Sổ giao dịch

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Ví** → tab **Sổ giao dịch** | Danh sách giao dịch mới nhất trước |
| 2 | Đọc từng dòng | Loại giao dịch, mô tả, số tiền (+/−), **số dư sau giao dịch**, thời gian |
| 3 | Bấm **Tải thêm** | Xem tiếp các giao dịch cũ hơn |

Mẹo đối chiếu nhanh: lấy số dư của một dòng bất kỳ, tự cộng/trừ các dòng phía
sau theo thứ tự - kết quả phải bằng số dư hiện tại. Nếu thấy bất thường, liên hệ
hỗ trợ (kèm mã giao dịch) - hệ thống có sổ cái bất biến để kiểm tra.

## 12.6. Rút tiền

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Ví** → **Rút tiền** | Danh sách tài khoản nhận tiền (nếu đã thêm) |
| 2 | Thêm tài khoản nhận tiền: ngân hàng, số tài khoản, chủ tài khoản | Tài khoản hiển thị dạng che `****6789` |
| 3 | Nhập số tiền (không quá số dư khả dụng) và gửi yêu cầu | Lệnh ở trạng thái **Chờ duyệt** |
| 4 | Chờ nhân viên duyệt và ngân hàng chuyển khoản | Trạng thái: Chờ duyệt → Đang chuyển → **Thành công** |
| 5 | Kiểm tra sổ giao dịch | Có dòng "Rút tiền" (số tiền âm, ghi chú mã lệnh) |

- Tiền được **giữ lại ngay khi nhân viên duyệt** (không còn nằm trong số dư khả
  dụng) để tránh rút trùng.
- Nếu ngân hàng báo lỗi (sai số tài khoản...), lệnh chuyển **Thất bại** và tiền
  được hoàn lại ví tự động; xem lý do trong chi tiết lệnh.
- Thời gian xử lý mục tiêu: trong giờ làm việc (cần chốt SLA chính thức).

## 12.7. Bán mỹ phẩm second-hand (Seller)

### Đăng tin

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Đăng bán** | Form đăng tin |
| 2 | Chọn sản phẩm/danh mục, nhập giá, % đã dùng, hạn dùng còn lại, mô tả | Dữ liệu hợp lệ theo validate |
| 3 | Tải lên 3-10 ảnh: sản phẩm các góc + **ảnh chứng minh mua hàng** | Ảnh upload thành công (tối đa 5 MB/ảnh) |
| 4 | Bấm **Gửi duyệt** | Tin ở trạng thái **Chờ duyệt** - chưa hiển thị công khai |

### Trạng thái tin đăng

| Trạng thái | Ý nghĩa | Bạn cần làm gì |
| ---------- | ------- | -------------- |
| Chờ duyệt | Nhân viên đang kiểm tra | Chờ (thường trong ngày làm việc) |
| Đã duyệt | Hiển thị công khai trên chợ | Chờ người mua |
| Bị từ chối | Có lý do cụ thể | Đọc lý do, sửa tin, gửi duyệt lại |
| Đã bán | Có người mua và đã thanh toán | Đóng gói, gửi hàng |
| Tạm ẩn | Nhân viên ẩn (vi phạm/chờ xác minh) | Xem lý do, liên hệ hỗ trợ nếu cần |

### Khi có đơn bán

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Nhận thông báo đơn mới ở **Đơn bán** | Địa chỉ người mua để gửi hàng |
| 2 | Gửi hàng qua đơn vị vận chuyển | Giữ mã vận đơn |
| 3 | Chờ trạng thái **Đã giao** và hết thời gian khiếu nại | Hoặc người mua xác nhận sớm |
| 4 | Tiền được giải phóng vào ví | Số dư tăng = giá bán trừ hoa hồng nền tảng (mặc định 5%, sẽ công bố chính thức) |
| 5 | Rút tiền về ngân hàng | Theo mục 12.6 |

**Lưu ý cho seller**

- Chỉ đăng hàng chính hãng, còn hạn sử dụng, mô tả trung thực; hàng giả/hết hạn
  bị từ chối hoặc khoá tài khoản.
- Số lượng mỗi tin là 1 (đặc thù second-hand); bán xong tạo tin mới nếu có món
  khác.
- Tiền chỉ được giải phóng khi đơn giao thành công - đây là bảo vệ cho cả hai
  bên.

## 12.8. Khu vực vận hành (Staff)

### Duyệt tin đăng

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Duyệt tin** - danh sách `Chờ duyệt` | Tin mới nhất trước; xem ảnh lớn, thông tin |
| 2 | Kiểm tra checklist: chính hãng? đúng danh mục? hạn dùng? ảnh chứng minh khớp? giá hợp lý? | - |
| 3a | Đạt: bấm **Duyệt** | Tin lên chợ ngay; audit ghi nhận |
| 3b | Không đạt: bấm **Từ chối** + nhập lý do rõ ràng | Seller nhận lý do; tin về `Bị từ chối` |

### Xử lý đơn hàng

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Đơn hàng**, lọc `PAID`/`READY_TO_SHIP` | Danh sách đơn cần xử lý |
| 2 | Chuẩn bị hàng, bấm **Sẵn sàng giao** | Trạng thái `READY_TO_SHIP` |
| 3 | Nhập mã vận đơn, bấm **Đã gửi** | Trạng thái `SHIPPED`; buyer thấy timeline |
| 4 | Khi giao thành công, bấm **Đã giao** (hoặc chờ buyer xác nhận) | Trạng thái `DELIVERED` |
| 5 | Bấm **Release** khi đủ điều kiện (hết khiếu nại) | Escrow trả seller + hoa hồng về quỹ nền tảng; đơn `Hoàn tất` |
| 5' | Nếu có tranh chấp hợp lệ: bấm **Hoàn tiền** + lý do | Tiền về ví buyer; đơn `Đã hoàn tiền` |

Chú ý: hệ thống chỉ cho **Release** đơn ở trạng thái `Đã giao` và còn tiền trong
escrow; mọi thao tác release/refund cần lý do khi là ngoại lệ.

### Duyệt lệnh rút tiền

| Bước | Hành động | Kết quả mong đợi |
| ---- | --------- | ---------------- |
| 1 | Vào **Lệnh rút**, lọc `Chờ duyệt` | Số tài khoản che một phần, số dư hiện tại của người dùng |
| 2a | Hợp lệ: bấm **Duyệt** | Tiền rời ví người dùng vào `WITHDRAWAL_CLEARING`; trạng thái `Đã duyệt` |
| 2b | Không hợp lệ: bấm **Từ chối** + lý do | Trạng thái `Từ chối`; ví không đổi |
| 3 | Chuyển khoản ngân hàng theo thông tin (hiển thị đầy đủ cho staff theo quy trình) | - |
| 4a | Ngân hàng xác nhận thành công: bấm **Settle** | Trạng thái `Thành công`; clearing → gateway |
| 4b | Ngân hàng báo lỗi: bấm **Báo thất bại** + lý do | Tiền hoàn về ví người dùng; trạng thái `Thất bại` |

Nguyên tắc an toàn: **không bao giờ** chuyển khoản trước khi bấm Duyệt trong hệ
thống; mọi hành động đều có audit kèm tên nhân viên.

## 12.9. Admin

Ngoài toàn bộ quyền staff:

| Việc | Mô tả |
| ---- | ----- |
| Quản lý danh mục/sản phẩm B2C | Thêm/sửa danh mục, sản phẩm, tồn kho, flash sale |
| Điều chỉnh ngoại lệ (`ADJUSTMENT`) | Chỉ khi có sự cố đã xác minh; bắt buộc lý do + tham chiếu ticket; tạo transfer mới, không sửa sổ cũ |
| Báo cáo doanh thu/hoa hồng | Xuất theo kỳ phục vụ kê khai thuế sàn TMĐT |
| Quản lý người dùng | Khoá/mở khoá tài khoản, đổi role (có audit) |

## 12.10. Câu hỏi thường gặp và xử lý sự cố

| Tình huống | Xử lý |
| ---------- | ----- |
| Đã chuyển khoản nạp tiền nhưng chưa thấy số dư | Chờ 1-2 phút; kiểm tra đúng nội dung chuyển khoản; nếu vẫn chưa có, liên hệ hỗ trợ kèm ảnh biên lai |
| Bấm thanh toán nhiều lần | Hệ thống chống trùng: chỉ một giao dịch được thực hiện; số dư không bị trừ hai lần |
| Đơn bị hủy dù chưa muốn hủy | Đơn quá hạn giữ chỗ (mặc định 10 phút); tạo đơn mới |
| Không thấy tin đăng trên chợ | Tin đang chờ duyệt/bị từ chối/tạm ẩn - xem trạng thái ở **Đăng bán** |
| Tranh chấp: cần cung cấp gì? | Ảnh/video tình trạng hàng khi nhận, mã đơn, mô tả sai lệch so với tin đăng |
| Quên mật khẩu | Dùng "Quên mật khẩu" ở trang đăng nhập |
| Tài khoản bị khoá thao tác tiền | Liên hệ hỗ trợ kèm email tài khoản |

## 12.11. Chính sách hiển thị cho người dùng

Trước khi go-live, các nội dung sau phải được công bố công khai trên web (nghĩa
vụ theo NFR-25):

1. Chính sách đổi trả/hoàn tiền (điều kiện, thời hạn, quy trình).
2. Danh sách tổ chức cung ứng dịch vụ thanh toán mà nền tảng hợp tác và lựa
   chọn của người mua.
3. Kênh tiếp nhận khiếu nại + thời hạn phản hồi.
4. Điều khoản sử dụng và chính sách bảo mật dữ liệu cá nhân.
