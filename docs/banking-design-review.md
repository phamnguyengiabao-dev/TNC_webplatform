> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](backend/SHOPEE_SHOWROOM_BACKEND.md).

# Review thiết kế Banking — TNC Marketplace

Ngày: 2026-10-14. Phạm vi: `schema.prisma` và `banking.service.ts` trong bản mô tả
stack NestJS + Prisma + Supabase.

Bối cảnh quan trọng: đây là hệ thống kinh doanh thật, giữ tiền thật của người bán
và người mua. Vì vậy review này đặt tiêu chuẩn "một bug không được phép làm tiền
biến mất", chứ không phải "code chạy được".

Kết luận ngắn: ý tưởng nền (ví nội bộ + sổ giao dịch + Prisma transaction) là
đúng hướng, nhưng bản thiết kế hiện tại **không bảo toàn tiền**, **không có
escrow**, **không chống webhook trùng lặp**, và có một **lỗ hổng bảo mật đặc thù
của Supabase** cần kiểm tra ngay. Có một lỗi crash chắc chắn xảy ra khi ví chưa
tồn tại.

Bản vá đi kèm: `prisma/schema.prisma`, `prisma/sql/finance_guards.sql`,
`src/common/money.ts`, `src/modules/banking/ledger.service.ts`,
`src/modules/banking/banking.service.ts`, `src/modules/banking/ledger.errors.ts`.

---

## S1 — Tiền không được bảo toàn: thiếu ví hệ thống (nghiêm trọng)

Người mua trả 100.000, người bán nhận 95.000 sau hoa hồng 5%. Trong thiết kế cũ,
sổ `Transaction` chỉ có hai dòng: `-100.000` cho người mua và `+95.000` cho người
bán. 5.000 đồng hoa hồng không có dòng nào. Tổng sổ là `-5.000`.

Hệ quả thực tế: bạn không bao giờ đối chiếu được. Khi số dư lệch, bạn không có
cách nào biết lệch vì hoa hồng, vì bug, hay vì ai đó đã sửa tay trong Supabase
Studio. Sau vài nghìn đơn, con số lệch đủ lớn để bạn không dám tin bất kỳ báo cáo
nào nữa.

Bản vá đưa vào bốn ví hệ thống (`WalletKind`): `PLATFORM_REVENUE` nhận hoa hồng,
`ESCROW` giữ tiền tạm, `GATEWAY_CLEARING` đại diện cho thế giới bên ngoài (cổng
thanh toán / ngân hàng), và `WITHDRAWAL_CLEARING` giữ tiền đang trên đường ra
ngân hàng. Mọi lần tiền di chuyển trở thành một `LedgerTransfer` gồm **từ hai
`LedgerEntry` trở lên, có dấu, tổng bằng đúng 0**.

Nạp tiền trở thành `GATEWAY_CLEARING -100.000` và `user +100.000`. Số dư của
`GATEWAY_CLEARING` vì vậy luôn âm, và giá trị tuyệt đối của nó chính là tổng tiền
thật đã chảy vào hệ thống — con số bạn đối chiếu với sao kê của cổng thanh toán.

Và quan trọng nhất: bất biến này được **database** bảo vệ, không phải code. Xem
mục 4 của `finance_guards.sql` — một constraint trigger hoãn đến COMMIT:

```sql
create constraint trigger ledger_entry_balanced
  after insert on public."LedgerEntry"
  deferrable initially deferred
  for each row execute function public.assert_transfer_balanced();
```

Một transfer quên mất chân hoa hồng sẽ không commit được. Đây là thứ đáng giá
nhất trong toàn bộ bản vá.

---

## S2 — Thiếu escrow: người bán nhận tiền ngay lúc người mua trả (nghiêm trọng)

Đây là rủi ro kinh doanh lớn nhất, không chỉ là vấn đề kỹ thuật.

Với mỹ phẩm second-hand C2C, người mua trả tiền trước khi nhìn thấy hàng. Nếu bạn
cộng tiền vào ví người bán ngay tại bước thanh toán, thì khi người bán không gửi
hàng, gửi hàng fake, hoặc gửi hàng hết hạn, tiền đã nằm trong ví họ. Họ rút ra là
xong. Lúc đó hoàn tiền cho người mua không còn là một bút toán nữa — nó là tiền
của TNC bỏ ra, và việc đòi lại từ người bán là chuyện ngoài hệ thống.

Mô hình escrow trong bản vá:

```
checkout   buyer  -gross   ->  ESCROW +gross
release    ESCROW -gross   ->  seller +(gross - commission), PLATFORM_REVENUE +commission
refund     ESCROW -gross   ->  buyer  +gross
```

`releaseOrder()` chỉ chấp nhận đơn ở trạng thái `DELIVERED`. Trước thời điểm đó,
hoàn tiền chỉ là một `LedgerTransfer` ngược chiều.

Quyết định nghiệp vụ bạn cần chốt, mình đặt mặc định bảo thủ: thời gian tự động
release sau khi `DELIVERED` (ví dụ 3 ngày để người mua kiểm hàng và mở khiếu
nại). Hiện bản vá chưa có job tự động release — `releaseOrder()` phải được gọi
tường minh. Nói cho mình biết con số bạn muốn, mình thêm scheduled job và đưa nó
thành biến cấu hình.

---

## S3 — Lỗi crash và race condition trong `processPayment` (nghiêm trọng)

Đoạn code cũ:

```ts
const wallet = await tx.$queryRaw`
  SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
` as any;

if (!wallet || wallet[0].balance < amount) {
  throw new BadRequestException('Insufficient account balance for payment.');
}
```

Có bốn vấn đề riêng biệt ở đây.

**Crash chắc chắn.** `$queryRaw` trả về một array. Khi ví không tồn tại, array
rỗng — và `![]` là `false`, không phải `true`. Điều kiện `!wallet` không bao giờ
đúng, nên code đi tiếp tới `wallet[0].balance` và ném `TypeError: Cannot read
properties of undefined`. Người dùng nhận 500 thay vì một thông báo rõ ràng.
Phải là `wallet.length === 0`.

**So sánh tiền bằng toán tử JS.** `wallet[0].balance` là một `Prisma.Decimal`,
`amount` là `number`. Phép `<` buộc JS gọi `valueOf()` rồi so sánh dưới dạng
double. Với số tiền VND nhỏ thì "may mà đúng", nhưng nó phụ thuộc vào ép kiểu
ngầm và sẽ mất chính xác ở giá trị lớn. Tệ hơn, `amount: number` nghĩa là số tiền
đã đi qua `JSON.parse` dưới dạng double trước khi tới đây. Bản vá dùng
`Prisma.Decimal` từ đầu đến cuối (`src/common/money.ts`) và **từ chối** nhận
`number` ở hàm `money()` — nếu một số đã là `number` thì nó đã qua một biểu diễn
mất mát rồi.

**`SELECT FOR UPDATE` là cách tiếp cận sai ở đây.** Không phải vì nó sai logic,
mà vì nó giữ row lock suốt thời gian còn lại của transaction trong khi code
JavaScript chạy. Prisma interactive transaction mặc định timeout 5 giây; trong
một đợt flash sale, các request xếp hàng chờ lock và lần lượt timeout. Cách đúng
là gộp kiểm tra và ghi vào **một câu lệnh có điều kiện bảo vệ**:

```sql
UPDATE "Wallet"
   SET balance = balance + :delta, version = version + 1, "updatedAt" = now()
 WHERE id = :id
   AND (kind <> 'USER' OR balance + :delta >= 0)
RETURNING id, balance
```

Postgres tự đánh giá điều kiện trên đúng dòng nó sắp sửa. Hai request đồng thời
không thể cùng thấy số dư đủ. Zero rows affected nghĩa là "không đủ tiền hoặc
không có ví", và chưa có gì bị ghi. Đây chính xác là nguyên tắc mà bản spec
Spring cũ đã đặt ra cho `stock_quantity`, áp dụng cho số dư.

**Ví có thể chưa tồn tại.** Bản vá provision ví ngay lúc đăng ký bằng trigger
trên `auth.users` (mục 7 của `finance_guards.sql`), thay vì tạo lazy — tạo lazy
thì hai request đồng thời sẽ đua nhau và một bên fail.

Thêm một chi tiết nhỏ nhưng thật: `processPayment(userId: String, orderId: String)`
dùng `String` hoa — đó là kiểu wrapper object của TypeScript, không phải
`string`. Nó chạy được nhưng sai, và sẽ làm bạn bối rối khi gặp lỗi kiểu.

---

## S4 — Không có idempotency: webhook retry sẽ cộng tiền nhiều lần (nghiêm trọng)

VNPay, MoMo, ZaloPay và các dịch vụ đối soát ngân hàng đều **retry webhook cho
đến khi nhận được 2xx**. Thiết kế cũ không có khoá nào ngăn việc đó, nên một lần
nạp 500.000 bị gọi lại ba lần sẽ thành 1.500.000 trong ví. Đây là mất tiền trực
tiếp, và kẻ khai thác chỉ cần làm cho response của bạn timeout.

`referenceId String?` không giải quyết được vì nó không unique.

Bản vá đặt `idempotencyKey String @unique` trên `LedgerTransfer`. Khoá được sinh
tất định từ sự kiện nghiệp vụ: `deposit:<gatewayRef>`,
`order-payment:<orderId>`, `withdrawal-approve:<requestId>`. Lần gọi thứ hai đụng
unique index và bị **database** từ chối, không phải bị logic ứng dụng từ chối —
logic ứng dụng có thể bị race, unique index thì không.

Hàm `once()` trong `banking.service.ts` có hai lớp, cả hai đều cần: kiểm tra
trước để trả lời nhanh cho retry thông thường, và khi thao tác thất bại thì tra
lại khoá idempotency lần nữa trước khi ném lỗi — nếu một request đồng thời đã
thắng cuộc đua (dù thắng bằng `P2002` trên unique index hay bằng câu UPDATE
trạng thái có điều kiện) thì trả về replay thay vì lỗi.

Ngoài ra có `IdempotencyRecord` cho tầng API, dùng cho các endpoint có side
effect ngoài sổ sách (gửi mail, gọi PSP, tạo đơn). Quy ước: cùng key + cùng
payload thì trả lại response đã lưu; cùng key + payload khác thì 409.

Lưu ý nghiệp vụ quan trọng: `confirmDeposit()` **chỉ được** gọi từ handler đã
verify signature của cổng thanh toán, và `amount` phải đọc từ payload của cổng,
không bao giờ từ client. Số tiền do client gửi lên là lời mời in tiền.

---

## S5 — Bảng tài chính trong schema `public` của Supabase (bảo mật, cần kiểm tra ngay)

Đây là cái mình muốn bạn kiểm tra trước tất cả những thứ khác.

Prisma tạo bảng bằng DDL thuần, **không** bật row level security. Supabase thì
mặc định cấp quyền trên bảng trong schema `public` cho role `anon` và
`authenticated`, và PostgREST expose schema `public` ra HTTPS. Khoá `anon` là
khoá công khai theo thiết kế — nó nằm trong bundle frontend của bạn.

Nghĩa là bảng `Wallet` do Prisma tạo có thể đọc được, và có khả năng ghi được,
bởi bất kỳ ai trên internet có khoá `anon` của bạn. Một request `PATCH` tới
`/rest/v1/Wallet` để tự nâng số dư là điều cần loại trừ trước khi mở bán.

Đã kiểm chứng ngày 2026-10-14 (nguồn ở mục "Kiểm chứng & rà soát" cuối file):
tài liệu Supabase xác nhận bảng trong `public` được cấp grant mặc định cho
`anon`/`authenticated` ngay khi tạo, và khi chưa bật RLS thì bất kỳ ai cầm
publishable key đều đọc/ghi được mọi dòng. Supabase đang đổi mặc định này —
30/5/2026 cho project mới và **30/10/2026 áp cho toàn bộ project hiện hữu** —
nghĩa là cửa sổ rủi ro vẫn đang mở cho tới hết tháng 10/2026. Chạy hai câu lệnh
sau trong Supabase SQL editor:

```sql
select relname, relrowsecurity as rls_enabled
  from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relname;

select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated')
 order by table_name, grantee;
```

Nếu `rls_enabled` là `false` trên `Wallet`/`LedgerEntry`, hoặc `anon` xuất hiện
với `INSERT`/`UPDATE`/`DELETE`, hãy coi đó là sự cố đang diễn ra và chạy mục 1
của `finance_guards.sql`.

Cách vá: bật RLS **không kèm policy nào**. Prisma kết nối bằng role chủ sở hữu
bảng (`postgres`), và chủ sở hữu bỏ qua RLS, nên NestJS vẫn hoạt động bình
thường trong khi `anon`/`authenticated` bị chặn sạch. Cố ý **không** dùng `force
row level security`, vì nó sẽ áp RLS lên cả chủ sở hữu và khoá luôn Prisma ra
ngoài.

Thêm một bước dễ bị bỏ qua: Supabase default privileges sẽ cấp quyền lại cho
**mọi bảng mới**, nên lần `prisma migrate` tiếp theo sẽ mở lại lỗ hổng. Đổi mặc
định thành deny một lần:

```sql
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
```

Sau đó, việc expose một bảng ra frontend trở thành hành động tường minh và review
được. Nếu bạn muốn chắc ăn hơn nữa, bước tiếp theo là chuyển toàn bộ bảng tài
chính sang một schema riêng (`finance`) không nằm trong danh sách Exposed schemas
— lúc đó PostgREST không nhìn thấy chúng chứ không chỉ bị từ chối. Bản vá chưa
làm bước này vì nó cần `multiSchema`; giờ `prisma validate` đã chạy được (Prisma
6, xem mục cuối file) nên đây là việc có thể làm ở lần cập nhật tới nếu bạn muốn.

---

## S6 — Số dư không có ràng buộc, sổ không bất biến (cao)

Trong thiết kế cũ không có gì ngăn `balance` xuống âm, và không có gì ngăn ai đó
`UPDATE` hay `DELETE` một dòng trong sổ. Một sổ kế toán có thể sửa được thì không
phải sổ kế toán.

Bản vá thêm `CHECK (kind <> 'USER' OR balance >= 0)`, cộng thêm
`CHECK (code IS DISTINCT FROM 'ESCROW' OR balance >= 0)`: `GATEWAY_CLEARING` và
`WITHDRAWAL_CLEARING` được phép âm, nhưng escrow thì không. Thêm trigger chặn
`UPDATE`/`DELETE` trên `LedgerEntry`, và chặn mọi thay đổi trên `LedgerTransfer`
ngoài cột `status`. Sai sót được sửa bằng một transfer ngược chiều
(`LedgerService.reverse()`), giữ nguyên dòng gốc — người đối soát phải thấy được
cả việc đã có sai sót và việc nó đã được sửa.

Mỗi `LedgerEntry` lưu thêm `balanceAfter`, chụp từ `RETURNING` của câu UPDATE có
điều kiện. Nhờ đó bạn phát hiện lệch mà không phải tính lại toàn bộ sổ, và có
view `WalletReconciliation` để job định kỳ cảnh báo. Trong integration test,
`select count(*) from "WalletReconciliation" where drift <> 0` phải luôn bằng 0 —
đó là bằng chứng rẻ nhất cho tính đúng đắn của toàn bộ logic tiền.

---

## S7 — `Decimal(12, 2)` quá hẹp và sai đơn vị cho VND (cao)

`DECIMAL(12,2)` tối đa 9.999.999.999,99 — khoảng 10 tỷ đồng. Ví của một người
dùng thì không sao, nhưng `GATEWAY_CLEARING` và `PLATFORM_REVENUE` tích luỹ theo
tổng GMV từ ngày mở bán. 10 tỷ VND là mốc một cửa hàng mỹ phẩm hoàn toàn có thể
vượt, và khi vượt thì Postgres ném `numeric field overflow` ngay giữa một giao
dịch thanh toán. Bản vá dùng `DECIMAL(18,2)`.

Về đơn vị: VND không có đơn vị nhỏ hơn đồng, nên mọi số tiền vào sổ phải là số
nguyên. Bản vá ràng buộc điều đó ở cả hai phía — `assertWholeDong()` trong code
để có thông báo lỗi đọc được, và `CHECK (amount = round(amount))` trong database
làm chốt cuối.

Chi tiết dễ sai nhất ở đây là làm tròn hoa hồng. Nếu bạn làm tròn hoa hồng và
tiền người bán **độc lập**, hai con số có thể cộng lại lệch một đồng so với tổng,
và transfer sẽ không balance. `splitCommission()` chỉ làm tròn hoa hồng, còn tiền
người bán là **phần còn lại**:

```ts
const commission = gross.mul(rateBps).div(10_000)
  .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
return { commission, sellerAmount: gross.sub(commission) };
```

Nhờ thứ tự đó, `commission + sellerAmount === gross` đúng theo cấu trúc, không
phải đúng nhờ may mắn.

Mặc định mình đặt hoa hồng 5,00% (`APP_COMMISSION_BPS=500`, đơn vị basis point để
biểu diễn được 2,5% mà không cần số thực). Đây là **giả định** — bạn cần chốt con
số thật. Hoa hồng được đóng băng vào `Order.commissionAmount` tại lúc checkout,
nên việc bạn đổi tỷ lệ sau này không làm thay đổi số tiền đã thoả thuận trên các
đơn cũ.

---

## S8 — `TxStatus.PENDING` nằm chung bảng với dòng ảnh hưởng số dư (cao)

Thiết kế cũ có `PENDING | SUCCESS | FAILED` trên cùng bảng với các dòng cộng trừ
số dư. Điều này làm mọi phép tính số dư trở nên mơ hồ: `sum(amount)` có tính dòng
PENDING không? Mỗi query ở mỗi nơi sẽ trả lời khác nhau, và đó là cách số dư bắt
đầu lệch.

Nguyên tắc trong bản vá: **sổ chỉ ghi lại tiền đã thực sự di chuyển.** Ý định
nằm trên `Order` và `WithdrawalRequest`, không nằm trong sổ.

Điều này đặc biệt quan trọng với rút tiền. Tiền phải bị trừ khỏi ví người dùng
**ngay khi lệnh rút được duyệt**, không phải khi ngân hàng chuyển thành công. Nếu
chờ, người dùng có thể tiêu hoặc rút lại đúng số tiền đó trong khoảng thời gian
lệnh đang bay. Tiền được đưa vào `WITHDRAWAL_CLEARING` — nghĩa đúng của nó là
"tiền đã hứa với ngân hàng nhưng chưa gửi". Khi ngân hàng từ chối,
`failWithdrawal()` post một transfer ngược để tiền quay lại ví, chứ không sửa
dòng cũ.

---

## S9 — `referenceId String?` không có toàn vẹn tham chiếu (trung bình)

Một con trỏ dạng text tới "OrderId hoặc mã cổng thanh toán" nghĩa là không có
foreign key, không join được tin cậy, và không ai biết dòng nào trỏ tới đâu sau
sáu tháng.

Bản vá tách đôi: `LedgerTransfer.orderId` là foreign key thật tới `Order`, còn
`externalRef` giữ lại mã của bên thứ ba (không unique, vì một mã bên ngoài có thể
sinh ra nhiều transfer trong vòng đời của nó). Thiết kế cũ cũng chưa có model
`Order` nào, nên mình thêm một bản tối giản đủ cho luồng tiền; module orders sẽ
mở rộng nó.

Về `userId` trỏ tới Supabase Auth: Prisma không nên sở hữu schema `auth`, và
không thể đặt foreign key sang đó một cách sạch sẽ. Bản vá thêm bảng
`UserProfile` làm bản sao trong schema của bạn, đồng bộ bằng trigger trên
`auth.users`. Mọi thứ trong domain tham chiếu tới `UserProfile`, nhờ đó không bao
giờ có ví mồ côi hay đơn trỏ tới người dùng không tồn tại.

---

## S10 — Thiếu index (trung bình)

Không có index nào trong thiết kế cũ. Màn hình "lịch sử giao dịch của tôi" sẽ
quét toàn bảng ngay khi sổ có vài trăm nghìn dòng.

Bản vá thêm `@@index([walletId, createdAt(sort: Desc)])` cho lịch sử,
`@@unique([transferId, walletId])` (chặn hai chân trùng ví trong một transfer,
đồng thời phục vụ việc gom chân và trigger cân bằng), và các index theo
`status` cho màn hình vận hành. Phần đọc dùng keyset pagination
(`getStatement()`) chứ không dùng OFFSET — OFFSET càng vào sâu càng chậm, và có
thể lặp hoặc bỏ sót dòng khi có giao dịch mới chen vào giữa lúc phân trang, điều
không chấp nhận được với một bảng sao kê mà người dùng đang đối chiếu bằng tay.

---

## S11 — Cấu hình kết nối Supabase (trung bình, dễ mất cả buổi để debug)

Supabase có hai cổng và chúng không thay thế được nhau. Prisma cần cả hai:

```env
# Transaction pooler — dùng cho runtime
DATABASE_URL="postgresql://...@...pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
# Direct connection — dùng cho prisma migrate
DIRECT_URL="postgresql://...@db....supabase.co:5432/postgres"
```

Thiếu `?pgbouncer=true` thì Prisma sẽ dùng prepared statement và bạn sẽ gặp lỗi
`prepared statement "s0" already exists` một cách ngẫu nhiên dưới tải. Thiếu
`directUrl` thì `prisma migrate` sẽ fail vì migration cần các câu lệnh ở mức
session mà pooler không chuyển tiếp được.

Ngoài ra, interactive transaction chiếm một kết nối trong pool suốt thời gian nó
chạy, và pool của Supabase khá nhỏ. Bản vá đặt timeout tường minh
(`timeout: 15_000, maxWait: 5_000`) và giữ `ReadCommitted` — các câu UPDATE có
điều kiện bảo vệ đã đủ, không cần nâng isolation level. Tuyệt đối không await một
HTTP call (PSP, SOAP, gửi mail) bên trong `$transaction`.

---

## S12 — Pháp lý: mô hình ví giữ tiền khách ở Việt Nam

Phần này ngoài phạm vi code nhưng mình nêu vì đây là kinh doanh thật, và nó có
thể thay đổi cả kiến trúc.

Khung pháp lý đã được kiểm chứng ngày 2026-10-14 (nguồn ở mục cuối file):

- Nghị định 52/2024/NĐ-CP (hiệu lực 01/7/2024) quy định dịch vụ ví điện tử, hỗ
  trợ thu hộ/chi hộ, cổng thanh toán điện tử... là các dịch vụ trung gian thanh
  toán **phải được Ngân hàng Nhà nước cấp phép**. Vốn điều lệ tối thiểu 50 tỷ
  đồng cho ví điện tử/thu hộ-chi hộ/cổng thanh toán. Ví điện tử phải đảm bảo tổng
  số dư trên các tài khoản đảm bảo thanh toán không thấp hơn tổng số dư ví khách
  hàng (tỷ lệ 1:1) và chỉ liên kết tài khoản/thẻ của chính khách hàng.
- TNC giữ số dư của người dùng rồi chi trả ra ngân hàng cho người bán nằm rất gần
  phạm vi điều chỉnh trên, trừ khi phần giữ tiền thật nằm ở một tổ chức đã được
  cấp phép. Đây không phải tư vấn pháp lý — xác nhận với luật sư trước khi mở
  chức năng rút tiền cho người bán.
- Luật Thương mại điện tử số 122/2025/QH15 (hiệu lực 01/7/2026) và Nghị định
  248/2026/NĐ-CP (30/6/2026) bổ sung nghĩa vụ cho sàn có chức năng đặt hàng: công
  bố chính sách đổi trả/hoàn tiền và thực hiện đúng chính sách, công khai tổ chức
  cung ứng dịch vụ thanh toán/trung gian thanh toán mà sàn hợp tác, cho người mua
  lựa chọn, tiếp nhận và xử lý khiếu nại. Luồng escrow/refund và `AuditLog` trong
  bản vá chính là hạ tầng cho các nghĩa vụ này.
- Nghị định 117/2025/NĐ-CP: nền tảng có chức năng đặt hàng và thanh toán phải
  khấu trừ, nộp thay thuế cho hộ/cá nhân kinh doanh — cần tính vào thiết kế
  hoá đơn/báo cáo ở giai đoạn sau (ngoài phạm vi file này).

Mô hình thường được dùng để tránh vướng: **không tự giữ tiền.** Dùng một cổng
thanh toán đã có giấy phép (VNPay, MoMo, ZaloPay) với tính năng escrow/payout
của họ, và `Wallet` + `LedgerEntry` của bạn chỉ là sổ kế toán nội bộ phản chiếu
số dư đang nằm ở cổng. Tin tốt là thiết kế trong bản vá hỗ trợ mô hình này gần
như không cần sửa gì: `GATEWAY_CLEARING` chính là điểm bạn đối chiếu với sao kê
của cổng, và `WITHDRAWAL_CLEARING` chính là các payout đang chờ. Khác biệt duy
nhất là tiền thật nằm ở đâu.

---

## Kiểm chứng & rà soát output (2026-10-14)

Phần này ghi lại kết quả chạy thật và các phát hiện khi rà soát chéo bản vá.

### Đã chạy được gì

- `prisma validate` (Prisma ORM 6.x) trên `prisma/schema.prisma`: **hợp lệ**.
  Lưu ý: CLI `prisma@latest` hiện là dòng Prisma Developer Platform 8.0.0-rc đã
  bỏ lệnh `validate`/`generate` kiểu cổ điển — hãy pin đúng major version ORM
  của dự án.
- `prisma generate` với schema này: chạy thành công, client sinh ra đầy đủ.
- `tsc --strict` (TypeScript 7, module NodeNext) trên `money.ts`,
  `ledger.errors.ts`, `ledger.service.ts`, `banking.service.ts` với Prisma client
  thật: **0 lỗi** sau khi sửa 2 lỗi biên dịch có thật (bên dưới).

Hai lỗi biên dịch phát hiện và đã sửa:

1. `Prisma.TransactionOptions` **không tồn tại** trong client Prisma 6 — kiểu này
   được khai báo inline ở overload `$transaction(fn, options)` và không export.
   Đã thay bằng interface `TxOptions` cục bộ trong `banking.service.ts`.
2. `new InsufficientFundsError(walletId, balance, amount)` gọi sai arity —
   constructor chỉ nhận `(walletId, requested)` (chủ ý không đưa balance vào
   message để không rò rỉ số dư). Đã bỏ tham số thứ ba.

### Tiền được bảo toàn trong mọi luồng

Kiểm tra từng luồng: tổng các chân của mỗi `LedgerTransfer` bằng 0 theo cấu trúc,
không phải nhờ may mắn:

- Nạp: `GATEWAY_CLEARING -a`, `user +a`.
- Thanh toán: `buyer -g`, `ESCROW +g`.
- Release C2C: `ESCROW -g`, `seller +(g-c)`, `PLATFORM_REVENUE +c` (c chỉ được
  làm tròn một lần, seller nhận phần còn lại nên `(g-c)+c=g` luôn đúng).
- Release retail (TNC là người bán): `ESCROW -g`, `PLATFORM_REVENUE +g`.
- Hoàn tiền: `ESCROW -g`, `buyer +g`.
- Duyệt rút: `user -a`, `WITHDRAWAL_CLEARING +a`; settle: clearing `-a`,
  gateway `+a`; thất bại: reverse đúng bằng ảnh gương.
- `reverse()` luôn lấy âm của từng chân gốc → tổng bằng 0.

Bất biến toàn cục: `select sum(amount) from "LedgerEntry"` luôn bằng 0.

### Sửa đổi bổ sung sau rà soát

- `LedgerService.reverse()` ném `AlreadyReversedError` đúng như khai báo thay vì
  `Error` trần.
- `once()` khi thất bại tra lại `idempotencyKey` trước khi ném lỗi, nên retry
  đồng thời (double-click, webhook retry) nhận replay thay vì lỗi 409/500.
- Thêm `assertEscrowHolds()` trong `releaseOrder`/`refundOrder`: tiền chỉ được
  release/refund tối đa bằng phần đã thực nộp vào escrow **của chính đơn đó**
  (escrow là ví dùng chung, kiểm tra tổng số dư không đủ để chặn một đơn chưa
  thanh toán rút tiền của đơn khác). Kèm constraint DB
  `wallet_escrow_non_negative` làm chốt cuối.
- `revoke all` bổ sung `"Order"` và `"UserProfile"` cho khớp danh sách RLS.
- `LedgerEntry` thêm `@@unique([transferId, walletId])` — DB cũng chặn hai chân
  cùng ví trong một transfer, không chỉ service.

### Nguồn đã kiểm chứng

- Supabase — changelog "Breaking Change: Tables not exposed to Data and GraphQL
  API automatically" (30/5/2026 cho project mới, 30/10/2026 cho toàn bộ project
  hiện hữu) và tài liệu bảng/API:
  https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically ,
  https://supabase.com/docs/guides/database/tables ,
  https://supabase.com/docs/guides/api/securing-your-api
- Nghị định 52/2024/NĐ-CP:
  https://chinhphu.vn/?classid=0&docid=210262&pageid=27160
- Luật Thương mại điện tử 122/2025/QH15:
  https://congbao.chinhphu.vn/van-ban/luat-so-122-2025-qh15-468683.htm
- Nghị định 248/2026/NĐ-CP:
  https://chinhphu.vn/?classid=0&docid=218747&pageid=27160
- Nghị định 117/2025/NĐ-CP (khấu trừ thuế trên nền tảng):
  https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=178299

### Còn lại / chưa làm

- Chưa có test tự động nào (xem mục "Việc nên làm theo thứ tự").
- Chưa có `@Catch()` filter map `LedgerError` → `ProblemDetail`; hiện chỉ mới có
  error classes, thiếu tầng HTTP.
- Chưa có scheduled job tự động release escrow; `releaseOrder()` phải gọi tường
  minh.
- `IdempotencyRecord` có model nhưng chưa có service/guard nào dùng.
- `finance_guards.sql` mục 7 (trigger `auth.users`) có thể cần chạy tay trong
  SQL editor nếu migration thiếu quyền trên schema `auth`.

## Việc nên làm theo thứ tự

Trước khi viết thêm bất kỳ dòng code nào: chạy hai câu diagnostic ở S5 trên
project Supabase của bạn. Nếu RLS đang tắt trên bảng tài chính, chạy mục 1 của
`finance_guards.sql` ngay. Đừng chờ mốc 30/10/2026 của Supabase — đó là lúc nền
tảng đổi mặc định, không phải lúc rủi ro bắt đầu.

Sau đó áp schema và guards:

```bash
# đã chạy trong buổi rà soát 2026-10-14: hợp lệ; dùng đúng major version ORM
# của dự án (buổi rà soát dùng dòng 6.x — prisma@latest giờ là CLI 8 rc đã bỏ
# các lệnh ORM cổ điển)
npx prisma validate
npx prisma migrate dev --create-only --name finance_core
# dán prisma/sql/finance_guards.sql vào migration.sql vừa sinh ra
npx prisma migrate dev
npx prisma generate
```

Rồi chốt ba con số nghiệp vụ mình đang đặt mặc định bảo thủ: tỷ lệ hoa hồng (mình
đặt 5,00%), thời gian tự động release escrow sau khi giao hàng (chưa có job),
và thời gian giữ chỗ cho món second-hand lúc checkout.

Phần chưa có và cần làm tiếp: test. Cụ thể là một test đồng thời cho `payForOrder`
(N request mua cùng lúc với số dư chỉ đủ cho một, đúng một thành công, số dư
không bao giờ âm), một test replay webhook nạp tiền ba lần và chỉ cộng tiền một
lần, một test hoàn tiền sau khi release phải bị từ chối, và một test
`WalletReconciliation` không có drift sau khi chạy hết các luồng. Mình **chưa
chạy được test nào** trong phiên này. Bù lại, `prisma validate`, `prisma
generate` và `tsc --strict` đã chạy thật và pass (chi tiết ở mục "Kiểm chứng &
rà soát output") — các file vá giờ là code đã được compiler xác nhận, không còn
chỉ là bản soát bằng mắt.


---

## Cập nhật phiên test (2026-10-14, sau review)

Mục "Còn lại / chưa làm" ở trên đã bớt được mục quan trọng nhất: **đã có test tự
động chạy thật**. Tóm tắt thay đổi trong phiên này:

### Đã làm

- Scaffold dự án NestJS chạy được: `package.json` (Nest 12, Prisma pin `6.19.3`,
  TypeScript `5.9` — ts-jest chưa hỗ trợ TS 7, Jest 30 + ts-jest 29.4),
  `tsconfig.json`, `src/prisma/` (`PrismaService` + `PrismaModule` — file mà
  `ledger.service.ts`/`banking.service.ts` import nhưng trước đó chưa tồn tại),
  `src/config/configuration.ts`.
- Migration thật: `prisma/migrations/20261014053909_finance_core/migration.sql`
  = DDL sinh từ `schema.prisma` + **toàn bộ `finance_guards.sql` nhúng ở cuối**.
  Từ giờ `npx prisma migrate deploy` cài cả schema lẫn guards trong một bước,
  không còn thao tác dán tay. `finance_guards.sql` (bản gốc, có sửa 2 chỗ) vẫn là
  nguồn để đọc/sửa; phần đầu file ghi rõ quy tắc đồng bộ với migration.
- Hai chỗ sửa trong `finance_guards.sql` để file áp được cho cả Supabase lẫn
  Postgres trắng: (1) tạo role `anon`/`authenticated` nếu chưa có trước khi
  REVOKE; (2) trigger `auth.users` bọc trong DO block — thiếu quyền thì `raise
  notice` thay vì làm đổ migration, chạy tay trong SQL editor như cũ.
- Bộ test (đã chạy, không phải kế hoạch): `npm test` → **17 unit + 34 e2e, tất
  cả pass**.
  - Unit `src/common/money.spec.ts`: làm tròn hoa hồng HALF_UP, bất biến
    `commission + seller === gross` cho mọi mức phí, whole-đồng, biên 0/100%.
  - Integration `test/ledger-guards.spec.ts`: các bảo chứng ở tầng DB — transfer
    lệch/1 chân/leg trùng/fractional đồng/zero-đồng đều không commit được; sổ
    append-only (UPDATE/DELETE bị trigger chặn); `Wallet` USER/ESCROW không âm;
    RLS bật + `anon`/`authenticated` không có quyền trên bảng tài chính; lỗi
    validation của `LedgerService`; `reverse()` đảo đúng và từ chối đảo lần hai.
  - E2E `test/banking.spec.ts`: đúng 4 kịch bản tài liệu yêu cầu — payForOrder
    đồng thời (5 request, đúng 1 thắng, số dư không âm), webhook nạp replay ×3
    (và race ×3) chỉ cộng tiền một lần, hoàn tiền sau release bị từ chối, và
    `WalletReconciliation` không drift sau khi chạy hết luồng; kèm withdrawal
    approve/settle/fail, escrow isolation (đơn chưa nạp không rút được escrow),
    statement keyset.
- Test harness `test/setup/pg-harness.ts`: dùng PostgreSQL cài sẵn trên máy
  (`initdb` vào `%TEMP%\tnc-pg-test-data`, port 55432, trust auth, **không đụng
  cụm DB của bạn**), mỗi lần chạy drop/recreate `tnc_test` rồi
  `prisma migrate deploy` — tức là chính đường đi sẽ dùng trên Supabase. Có thể
  trỏ sang server khác bằng `TEST_DATABASE_URL` (khi đó không drop database).
- Lệnh đã chạy thật: `npm run typecheck` (0 lỗi), `npm run build`, `npm test`
  (51 test pass), `npx prisma validate` (hợp lệ, cần `DATABASE_URL`/`DIRECT_URL`
  trong env), `npx prisma migrate deploy` + `prisma generate`.

### Vài cái bẫy ghi lại được

- NestJS 12 là **ESM-only**. Jest bản CJS cần Node ≥ 24.9 và chạy với
  `--experimental-vm-modules` (script npm đã set sẵn) mới `require()` được ESM.
- `TRUNCATE ... CASCADE` đi theo mọi FK trỏ *vào* bảng bị truncate — truncate
  `UserProfile` sẽ xoá luôn bảng `Wallet` (FK `Wallet.ownerId`) và mất 4 ví hệ
  thống. Script dọn dữ liệu phải DELETE theo thứ tự FK (xem
  `test/helpers/test-db.ts`).
- `LedgerService.systemWalletId()` cache trong process: đừng bao giờ xoá/re-seed
  ví hệ thống giữa chừng, id phải ổn định.
- ts-jest 29.4 chưa nhận TypeScript 7 (peer `<7`) nên dự án pin TS 5.9.

### Còn lại (giữ nguyên, trừ mục test đã xong)

- `@Catch()` filter map `LedgerError` → `ProblemDetail` + tầng controller +
  auth guard xác thực JWT Supabase. Hiện chưa có HTTP layer nào.
- Webhook handler thật (PayOS/VietQR/Stripe): verify chữ ký rồi mới gọi
  `confirmDeposit`; chưa có code nào trong repo nhận webhook.
- Scheduled job auto-release escrow sau `DELIVERED` (cần chốt số ngày).
- `IdempotencyRecord` vẫn chưa có service/guard dùng (idempotency hiện tại nằm ở
  `LedgerTransfer.idempotencyKey` — đủ cho các luồng tiền, nhưng chưa phủ các
  endpoint không có transfer như tạo đơn).
- Chốt 3 con số nghiệp vụ: commission (đang mặc định 5,00% qua
  `APP_COMMISSION_BPS`), thời gian auto-release, thời gian giữ chỗ listing.
- Chạy 2 câu diagnostic S5 trên project Supabase thật, rồi `prisma migrate
  deploy` (migration đã sẵn sàng).