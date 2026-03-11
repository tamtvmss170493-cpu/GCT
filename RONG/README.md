# Port Ecosystem — PIMS / GXT / GNT (Realtime)

## 1) Bạn đang có gì trong thư mục này

- `index.html`: Trang launcher mở PIMS/GXT/GNT
- `pims.html`: Điều độ (PIMS) — quét container/seal bằng camera + phát lệnh
- `gxt.html`: Tài xế xe container (GXT)
- `gnt.html`: Tài xế xe gấp (GNT)
- `shared/realtime-client.js`: client realtime dùng chung
- `server/`: realtime server (WebSocket + REST)

## 2) Cách chạy thực tế (đa thiết bị)

### Bước A — chạy Realtime Server

Trên máy/server có Node.js:

```bash
cd server
npm install
npm run start
```

Mặc định server chạy tại `http://localhost:8787`

Kiểm tra:
- `GET /health` (ok, số client)
- `POST /event` (PIMS phát event)
- WebSocket: `ws://<host>:8787`

### Bước B — deploy Frontend (Netlify)

Kéo thả **thư mục gốc** (chứa `index.html`, `pims.html`, `gxt.html`, `gnt.html`, `shared/`) lên Netlify.

Mở:
- `https://xxxx.netlify.app/`

### Bước C — cấu hình server URL trên từng app

Trên **PIMS**: bấm nút `SERVER` (góc thanh PHÁT LỆNH) → nhập URL realtime server (VD: `https://your-server.com`).

Trên **GXT/GNT**: bấm `Cấu hình Server` → nhập URL tương tự.

## 3) Luồng nghiệp vụ đã map theo mô tả

### GXT (tài xế xe container)
- **B1**: Onboarding (tài xế/biển số/đơn vị/hotline)
- **B2**: Book-up “đang kiểm tra seal” khi có `JOB_CREATED`
- **B3**: Book-up “đã hoàn thành” + nút **XÁC NHẬN** khi có `PIMS_DONE`
- **B4**: Bản đồ + giọng nói + nút **ĐÃ ĐẾN** (gửi `GXT_ARRIVED`)
- **B5**: Nút **KẾT THÚC** chỉ xuất hiện khi GNT gửi `GNT_DONE`
- **B6**: Phiếu ERP + slider check out (gửi `GXT_CHECKOUT`)

### GNT (tài xế xe gấp)
- **B1+**: Chờ thông báo `PIMS_DONE` + nút **XÁC NHẬN**
- **B2+**: Bản đồ (target do PIMS set) + bắt buộc **set vị trí đang đứng**
- **B3+**: Nút **HOÀN THÀNH** (gửi `GNT_DONE` → GXT được phép KẾT THÚC)
- **B4+**: Nút **XONG VIỆC** quay về màn hình chờ

## 4) Ghi chú triển khai thật

- Server hiện **lưu in-memory** (restart là mất state). Khi bạn muốn “production-grade”, mình sẽ nâng cấp sang PostgreSQL/Supabase/Firebase hoặc Redis + DB.
- Bản đồ hiện là “schematic” (tọa độ zone). Nếu bạn gửi ảnh/bản đồ chuẩn của cảng + tọa độ thật, mình sẽ thay bằng bản đồ đúng 1:1.

