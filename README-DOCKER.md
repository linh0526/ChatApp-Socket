# ChatApp Docker Deployment Guide

Hướng dẫn deploy ứng dụng ChatApp lên server sử dụng Docker.

## 📋 Yêu cầu hệ thống

- Docker >= 20.10
- Docker Compose >= 2.0
- Ít nhất 2GB RAM
- Ít nhất 5GB dung lượng ổ cứng

## 🚀 Quick Start

### 1. Chuẩn bị Environment Variables

Tạo file `.env` trong thư mục gốc của project:

```bash
# Sao chép template (nếu có) hoặc tạo file .env với nội dung sau:

# MongoDB Configuration
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=your-secure-mongodb-password
MONGO_DATABASE=chatapp
MONGO_PORT=27017

# Backend Configuration
BACKEND_PORT=5000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
CLIENT_ORIGIN=http://your-domain.com

# Frontend Configuration
FRONTEND_PORT=3000

# Environment
NODE_ENV=production
```

### 2. Build và chạy ứng dụng

```bash
# Build và start tất cả services
docker-compose up -d --build

# Xem logs
docker-compose logs -f

# Dừng ứng dụng
docker-compose down
```

### 3. Truy cập ứng dụng

- Frontend: http://your-server-ip:3000
- Backend API: http://your-server-ip:5000
- MongoDB: localhost:27017 (chỉ từ trong Docker network)

## 🏗️ Cấu trúc Services

### Backend Service
- **Image**: Node.js 18 Alpine
- **Port**: 5000 (có thể cấu hình qua BACKEND_PORT)
- **Environment Variables**:
  - `PORT`: Port chạy server (default: 5000)
  - `MONGO_URI`: MongoDB connection string
  - `CLIENT_ORIGIN`: Frontend URL cho CORS
  - `JWT_SECRET`: Secret key cho JWT authentication
  - `NODE_ENV`: Environment mode

### Frontend Service
- **Image**: Nginx Alpine (multi-stage build)
- **Port**: 3000 (có thể cấu hình qua FRONTEND_PORT)
- **Build Process**:
  - Stage 1: Build React app với Node.js
  - Stage 2: Serve static files với Nginx

### MongoDB Service
- **Image**: MongoDB 7 Jammy
- **Port**: 27017 (có thể cấu hình qua MONGO_PORT)
- **Environment Variables**:
  - `MONGO_INITDB_ROOT_USERNAME`: MongoDB root username
  - `MONGO_INITDB_ROOT_PASSWORD`: MongoDB root password
  - `MONGO_INITDB_DATABASE`: Default database name

## 🔧 Cấu hình nâng cao

### Custom Domain & SSL

1. **Cấu hình Reverse Proxy với Nginx**:

```nginx
# /etc/nginx/sites-available/chatapp
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

2. **Cài đặt SSL với Let's Encrypt**:

```bash
# Cài đặt certbot
sudo apt install certbot python3-certbot-nginx

# Tạo SSL certificate
sudo certbot --nginx -d your-domain.com
```

3. **Cập nhật CLIENT_ORIGIN**:

```bash
CLIENT_ORIGIN=https://your-domain.com
```

### Database Management

```bash
# Truy cập MongoDB shell
docker-compose exec mongodb mongosh -u admin -p

# Backup database
docker-compose exec mongodb mongodump --db chatapp --out /backup

# Restore database
docker-compose exec mongodb mongorestore /backup/chatapp
```

### Monitoring & Logs

```bash
# Xem logs của tất cả services
docker-compose logs -f

# Xem logs của service cụ thể
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f mongodb

# Kiểm tra health status
docker-compose ps
```

## 🔒 Security Best Practices

1. **Thay đổi tất cả default passwords**
2. **Sử dụng strong JWT_SECRET** (tối thiểu 32 ký tự)
3. **Cấu hình firewall** chỉ mở các port cần thiết (22, 80, 443)
4. **Regular backup** database
5. **Monitor logs** để phát hiện suspicious activities
6. **Update Docker images** regularly

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**:
   ```bash
   # Kiểm tra port đang sử dụng
   sudo netstat -tulpn | grep :3000

   # Thay đổi port trong .env file
   FRONTEND_PORT=3001
   BACKEND_PORT=5001
   ```

2. **MongoDB connection failed**:
   ```bash
   # Kiểm tra MongoDB container
   docker-compose logs mongodb

   # Restart MongoDB
   docker-compose restart mongodb
   ```

3. **Build failures**:
   ```bash
   # Clear Docker cache
   docker system prune -f

   # Rebuild without cache
   docker-compose build --no-cache
   ```

### Performance Optimization

1. **Resource limits** trong docker-compose.yml:
   ```yaml
   services:
     backend:
       deploy:
         resources:
           limits:
             memory: 512M
             cpus: '0.5'
   ```

2. **Database indexes** - xem MongoDB documentation

3. **Enable gzip compression** trong nginx config

## 📞 Support

Nếu gặp vấn đề trong quá trình deployment, kiểm tra:
1. Docker và Docker Compose versions
2. Environment variables đã được set đúng chưa
3. Logs của các services
4. Network connectivity giữa containers

