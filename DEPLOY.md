# Hướng Dẫn Deploy Ứng Dụng Chat Video Call Miễn Phí

Hướng dẫn chi tiết để deploy ứng dụng chat với video call lên các nền tảng miễn phí.

## 📋 Mục Lục

1. [Tổng Quan](#tổng-quan)
2. [Chuẩn Bị](#chuẩn-bị)
3. [Deploy Backend](#deploy-backend)
4. [Deploy Frontend](#deploy-frontend)
5. [Cấu Hình Domain](#cấu-hình-domain)
6. [Cấu Hình MongoDB](#cấu-hình-mongodb)
7. [Cấu Hình Biến Môi Trường](#cấu-hình-biến-môi-trường)
8. [Kiểm Tra và Troubleshooting](#kiểm-tra-và-troubleshooting)

---

## 🎯 Tổng Quan

Ứng dụng này bao gồm:
- **Backend**: Node.js + Express + Socket.IO + MongoDB
- **Frontend**: React + TypeScript + Vite

Chúng ta sẽ deploy:
- Backend lên **Render.com** (miễn phí)
- Frontend lên **Vercel** hoặc **Netlify** (miễn phí)
- MongoDB trên **MongoDB Atlas** (miễn phí)
- Domain miễn phí từ **Freenom** hoặc **Cloudflare**

---

## 📦 Chuẩn Bị

### 1. Tài Khoản Cần Thiết

Đăng ký các tài khoản miễn phí sau:
- [GitHub](https://github.com) - Lưu trữ code
- [Render.com](https://render.com) - Deploy backend
- [Vercel](https://vercel.com) hoặc [Netlify](https://netlify.com) - Deploy frontend
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) - Database
- [Freenom](https://www.freenom.com) hoặc [Cloudflare](https://cloudflare.com) - Domain miễn phí

### 2. Chuẩn Bị Code

Đảm bảo code đã được commit và push lên GitHub:
```bash
git add .
git commit -m "Prepare for deployment"
git push origin main
```

---

## 🚀 Deploy Backend

### Bước 1: Tạo MongoDB Atlas Database

1. Đăng nhập vào [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Tạo cluster miễn phí (M0 - Free)
3. Tạo database user:
   - Vào "Database Access" → "Add New Database User"
   - Username: `chatapp`
   - Password: Tạo password mạnh (lưu lại)
4. Whitelist IP:
   - Vào "Network Access" → "Add IP Address"
   - Chọn "Allow Access from Anywhere" (0.0.0.0/0) cho development
5. Lấy Connection String:
   - Vào "Database" → "Connect" → "Connect your application"
   - Copy connection string, ví dụ:
   ```
   mongodb+srv://chatapp:<password>@cluster0.xxxxx.mongodb.net/chatapp?retryWrites=true&w=majority
   ```

### Bước 2: Deploy Backend lên Render

1. Đăng nhập [Render.com](https://render.com)
2. Tạo Web Service mới:
   - Click "New" → "Web Service"
   - Connect GitHub repository
   - Chọn repository của bạn
3. Cấu hình:
   - **Name**: `chat-app-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Thêm Environment Variables:
   ```
   PORT=10000
   MONGO_URI=mongodb+srv://chatapp:<password>@cluster0.xxxxx.mongodb.net/chatapp?retryWrites=true&w=majority
   JWT_SECRET=<tạo một secret key ngẫu nhiên, ví dụ: my-super-secret-jwt-key-2024>
   CLIENT_ORIGIN=https://your-frontend-domain.vercel.app
   ```
5. Click "Create Web Service"
6. Đợi deploy xong, lưu lại URL backend (ví dụ: `https://chat-app-backend.onrender.com`)

---

## 🎨 Deploy Frontend

### Option 1: Deploy lên Vercel (Khuyến nghị)

1. Đăng nhập [Vercel](https://vercel.com)
2. Import Project:
   - Click "Add New" → "Project"
   - Import từ GitHub repository
3. Cấu hình:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Thêm Environment Variables:
   ```
   VITE_API_BASE_URL=https://chat-app-backend.onrender.com
   ```
5. Click "Deploy"
6. Lưu lại URL frontend (ví dụ: `https://chat-app-frontend.vercel.app`)

### Option 2: Deploy lên Netlify

1. Đăng nhập [Netlify](https://netlify.com)
2. Import Project:
   - Click "Add new site" → "Import an existing project"
   - Connect GitHub repository
3. Cấu hình:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/dist`
4. Thêm Environment Variables:
   - Vào "Site settings" → "Environment variables"
   - Thêm:
     ```
     VITE_API_BASE_URL=https://chat-app-backend.onrender.com
     ```
5. Click "Deploy site"

### Cập Nhật Backend CLIENT_ORIGIN

Sau khi có URL frontend, cập nhật lại `CLIENT_ORIGIN` trong Render:
1. Vào Render dashboard
2. Chọn backend service
3. Vào "Environment"
4. Cập nhật `CLIENT_ORIGIN` thành URL frontend của bạn
5. Click "Save Changes" (sẽ tự động redeploy)

---

## 🌐 Cấu Hình Domain Miễn Phí

### Option 1: Sử dụng Freenom (Domain .tk, .ml, .ga, .cf)

1. Đăng ký tại [Freenom](https://www.freenom.com)
2. Tìm domain miễn phí:
   - Vào "Services" → "Register a New Domain"
   - Tìm domain .tk, .ml, .ga, hoặc .cf
   - Thêm vào cart và checkout (miễn phí)
3. Cấu hình DNS:
   - Vào "My Domains" → Chọn domain
   - Vào "Manage Domain" → "Manage Freenom DNS"
   - Thêm CNAME record:
     ```
     Type: CNAME
     Name: www
     Target: chat-app-frontend.vercel.app
     TTL: 3600
     ```
   - Thêm CNAME cho backend (subdomain):
     ```
     Type: CNAME
     Name: api
     Target: chat-app-backend.onrender.com
     TTL: 3600
     ```

### Option 2: Sử dụng Cloudflare (Khuyến nghị)

1. Đăng ký tại [Cloudflare](https://cloudflare.com)
2. Mua domain từ Cloudflare (giá rẻ) hoặc transfer domain
3. Thêm domain vào Cloudflare:
   - Click "Add a Site"
   - Nhập domain
   - Chọn plan miễn phí
4. Cấu hình DNS:
   - Vào "DNS" → "Records"
   - Thêm CNAME cho frontend:
     ```
     Type: CNAME
     Name: www
     Target: chat-app-frontend.vercel.app
     Proxy: ON (orange cloud)
     ```
   - Thêm CNAME cho backend:
     ```
     Type: CNAME
     Name: api
     Target: chat-app-backend.onrender.com
     Proxy: ON
     ```

### Cấu Hình Custom Domain trên Vercel/Netlify

#### Vercel:
1. Vào project settings
2. Vào "Domains"
3. Thêm domain: `www.yourdomain.tk`
4. Làm theo hướng dẫn để cấu hình DNS

#### Netlify:
1. Vào "Domain settings"
2. Click "Add custom domain"
3. Nhập domain
4. Làm theo hướng dẫn

### Cập Nhật Environment Variables

Sau khi có domain, cập nhật:

**Backend (Render):**
```
CLIENT_ORIGIN=https://www.yourdomain.tk
```

**Frontend (Vercel/Netlify):**
```
VITE_API_BASE_URL=https://api.yourdomain.tk
```

---

## 🔧 Cấu Hình MongoDB

### Tạo Database và Collections

MongoDB Atlas sẽ tự động tạo collections khi ứng dụng chạy. Đảm bảo:
1. Database name trong connection string đúng (ví dụ: `chatapp`)
2. User có quyền read/write
3. Network Access đã whitelist IP của Render

### Kiểm Tra Connection

Sau khi deploy, kiểm tra logs trong Render để đảm bảo kết nối MongoDB thành công.

---

## ⚙️ Cấu Hình Biến Môi Trường

### Backend (.env trên Render)

```env
PORT=10000
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/chatapp?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-jwt-key-change-this
CLIENT_ORIGIN=https://www.yourdomain.tk
```

### Frontend (.env trên Vercel/Netlify)

```env
VITE_API_BASE_URL=https://api.yourdomain.tk
```

**Lưu ý**: Với Vite, biến môi trường phải bắt đầu bằng `VITE_`

---

## ✅ Kiểm Tra và Troubleshooting

### Kiểm Tra Backend

1. Truy cập: `https://api.yourdomain.tk` hoặc `https://chat-app-backend.onrender.com`
2. Nên thấy: `{"status":"ok","message":"Chat API is running"}`

### Kiểm Tra Frontend

1. Truy cập: `https://www.yourdomain.tk`
2. Đăng ký tài khoản mới
3. Test các tính năng:
   - Đăng nhập/Đăng ký
   - Gửi tin nhắn
   - Gọi video

### Troubleshooting

#### Backend không kết nối được MongoDB
- Kiểm tra connection string
- Kiểm tra network access trong MongoDB Atlas
- Kiểm tra username/password

#### Frontend không kết nối được Backend
- Kiểm tra `VITE_API_BASE_URL`
- Kiểm tra CORS settings trong backend
- Kiểm tra `CLIENT_ORIGIN` trong backend

#### Video Call không hoạt động
- Đảm bảo HTTPS (WebRTC yêu cầu HTTPS)
- Kiểm tra browser console để xem lỗi
- Kiểm tra camera/microphone permissions

#### Domain không hoạt động
- Đợi DNS propagate (có thể mất 24-48 giờ)
- Kiểm tra DNS records
- Kiểm tra SSL certificate (Vercel/Netlify tự động cấp)

---

## 📝 Lưu Ý Quan Trọng

### Render Free Tier
- Service có thể "sleep" sau 15 phút không hoạt động
- Lần đầu wake up có thể mất 30-60 giây
- Giới hạn 750 giờ/tháng

### MongoDB Atlas Free Tier
- 512MB storage
- Shared cluster
- Phù hợp cho development và small projects

### Domain Free
- Freenom domains có thể bị thu hồi nếu không sử dụng
- Cloudflare domains ổn định hơn

### Security
- **QUAN TRỌNG**: Thay đổi `JWT_SECRET` thành một giá trị ngẫu nhiên mạnh
- Không commit `.env` files lên GitHub
- Sử dụng HTTPS cho tất cả connections

---

## 🎉 Hoàn Thành!

Sau khi hoàn thành các bước trên, ứng dụng của bạn sẽ:
- ✅ Chạy trên domain miễn phí
- ✅ Có HTTPS tự động
- ✅ Kết nối với MongoDB Atlas
- ✅ Hỗ trợ video call qua WebRTC
- ✅ Hoàn toàn miễn phí!

Chúc bạn thành công! 🚀

