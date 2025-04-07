# Setup Guide

## Prerequisites

### Required Software
- Node.js >= 18.0.0
- PostgreSQL 14+ with TimescaleDB extension
- Redis 6+
- Docker (optional, for containerization)

## Local Development Setup

### 1. Database Setup

#### PostgreSQL & TimescaleDB
```bash
# Install PostgreSQL and TimescaleDB
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo apt-get install timescaledb-postgresql-14

# Create databases
psql -U postgres
CREATE DATABASE codetime;
CREATE DATABASE codetime_timeseries;

# Enable TimescaleDB extension
\c codetime_timeseries
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

#### Redis
```bash
# Install Redis
sudo apt-get install redis-server

# Start Redis service
sudo systemctl start redis
```

### 2. Application Setup

#### Clone Repository
```bash
git clone https://github.com/yourusername/codetime-analytics-backend.git
cd codetime-analytics-backend
```

#### Install Dependencies
```bash
npm install
```

#### Environment Configuration
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Server Configuration
NODE_ENV=development
PORT=3000
API_VERSION=v1
API_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3001

# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=codetime
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

# TimescaleDB Configuration
TIMESCALE_HOST=localhost
TIMESCALE_PORT=5432
TIMESCALE_DB=codetime_timeseries
TIMESCALE_USER=postgres
TIMESCALE_PASSWORD=your_password

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# Kafka Configuration
# Removed Kafka configuration
```

#### Database Migration
```bash
npx prisma migrate dev
```

#### Start Development Server
```bash
npm run dev
```

## Docker Deployment

### 1. Build Docker Image
```bash
docker build -t codetime-backend .
```

### 2. Docker Compose Setup
Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
      # Removed Kafka service

  postgres:
    image: timescale/timescaledb:latest-pg14
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your_password
      - POSTGRES_DB=codetime

  redis:
    image: redis:6
    ports:
      - "6379:6379"

  # Removed Kafka and Zookeeper services
```

### 3. Run with Docker Compose
```bash
docker-compose up -d
```

## Production Deployment

### 1. Security Considerations
- Enable TLS/SSL
- Set up proper firewalls
- Use strong passwords
- Implement rate limiting
- Enable audit logging

### 2. Monitoring Setup
```bash
# Install Prometheus
docker run -d -p 9090:9090 prom/prometheus

# Install Grafana
docker run -d -p 3001:3001 grafana/grafana
```

### 3. Backup Strategy
```bash
# PostgreSQL backup
pg_dump -U postgres codetime > backup.sql

# Redis backup
redis-cli save
```

### 4. Scaling Considerations
- Use load balancer for multiple app instances
- Set up Redis cluster
- Configure Kafka partitions
- Use connection pooling for databases

## Troubleshooting

### Common Issues

1. Database Connection Issues
```bash
# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log

# Check Redis logs
sudo tail -f /var/log/redis/redis-server.log
```

2. Application Logs
```bash
# View application logs
tail -f logs/app.log
```

## Maintenance

### Regular Tasks
1. Database maintenance
```bash
# Vacuum analyze
VACUUM ANALYZE;

# Update statistics
ANALYZE;
```

2. Log rotation
```bash
# Configure logrotate
sudo nano /etc/logrotate.d/codetime
```

3. Backup verification
```bash
# Test restore from backup
psql -U postgres codetime_test < backup.sql
```
