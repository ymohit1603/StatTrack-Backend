# CodeTime Analytics Backend

A high-performance backend system for tracking and analyzing coding activity data from VS Code/CLI plugins.

## Features

- Real-time heartbeat ingestion with deduplication
- Scalable architecture using Kafka for message processing
- Time-series data storage with TimescaleDB
- Redis caching for improved performance
- RESTful API with comprehensive documentation
- WebSocket support for real-time updates

## System Requirements

- Node.js >= 18.0.0
- PostgreSQL with TimescaleDB extension
- Redis
- Apache Kafka
- Docker (for containerization)

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/codetime-analytics-backend.git
   cd codetime-analytics-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## API Documentation

### Heartbeat Ingestion
- `POST /api/v1/heartbeats`
- Accepts an array of heartbeat events
- Requires API key authentication

### User Dashboard
- `GET /api/v1/summary`
- Retrieves coding activity summary
- Supports various time ranges

### API Key Management
- `POST /api/v1/auth/key`
- Generates new API keys for users
- Requires user authentication

## Architecture

The system uses a microservices architecture with the following components:

- Express.js API Gateway
- Kafka for message queuing
- TimescaleDB for time-series data
- PostgreSQL for user metadata
- Redis for caching and rate limiting

## Development

### Running Tests
```bash
npm test
```

### Code Style
```bash
npm run lint
```

## Deployment

The application can be deployed using Docker and orchestrated with Kubernetes:

```bash
docker build -t codetime-backend .
docker-compose up
```

## Performance

- Handles 10,000+ heartbeats/minute
- API response time < 500ms
- 99.9% uptime guarantee

## Security

- TLS 1.3 encryption
- API key authentication
- Rate limiting
- Input validation
- GDPR compliance

## License

MIT License
