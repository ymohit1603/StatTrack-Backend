# CodeTime Analytics API Documentation

## Base URL
```
http://localhost:3000/api/v1
```

## Authentication
Most endpoints require authentication using a JWT token. Include the token in the Authorization header:
```
Authorization: Bearer your_jwt_token
```

## Rate Limiting
- Free tier: 1,000 requests per day
- Standard tier: 10,000 requests per day
- Enterprise tier: Unlimited requests

## Endpoints

### Authentication

#### OAuth Login
- Twitter Login
  ```http
  GET /auth/twitter
  ```
- LinkedIn Login
  ```http
  GET /auth/linkedin
  ```

#### Get Current User
```http
GET /users/current
```
Returns the currently authenticated user's profile.

### Heartbeats

#### Submit Heartbeats
```http
POST /heartbeats
```
Submit coding activity data.

**Request Body:**
```json
{
  "heartbeats": [{
    "entity": "file/path",
    "type": "file",
    "category": "coding",
    "time": "2025-04-06T10:28:10Z",
    "project": "project-name",
    "language": "javascript",
    "lines": 100,
    "lineDelta": 5
  }]
}
```

### Dashboard

#### Get Activity Summary
```http
GET /dashboard/summary
```
Get coding activity summary for the current user.

Query Parameters:
- `start`: Start date (ISO format)
- `end`: End date (ISO format)
- `interval`: Data granularity (hour, day, week, month)

#### Get Project Stats
```http
GET /dashboard/projects
```
Get statistics for all projects.

### Goals

#### Create Goal
```http
POST /goals
```
Create a new coding goal.

**Request Body:**
```json
{
  "type": "daily_coding",
  "target": 120,
  "unit": "minutes",
  "startDate": "2025-04-06",
  "endDate": "2025-05-06"
}
```

#### Get Goals
```http
GET /goals
```
Get all goals for the current user.

### Preferences

#### Update Preferences
```http
PUT /preferences
```
Update user preferences.

**Request Body:**
```json
{
  "theme": "dark",
  "notifications": {
    "email": true,
    "desktop": false
  },
  "privacyLevel": "private"
}
```

### Reports

#### Generate Report
```http
POST /reports
```
Generate a custom coding activity report.

**Request Body:**
```json
{
  "type": "activity",
  "dateRange": {
    "start": "2025-03-06",
    "end": "2025-04-06"
  },
  "metrics": ["time", "lines", "languages"],
  "format": "pdf"
}
```

### Team Collaboration

#### Create Team
```http
POST /teams
```
Create a new team.

**Request Body:**
```json
{
  "name": "Frontend Team",
  "description": "Frontend development team"
}
```

#### Add Team Member
```http
POST /teams/{teamId}/members
```
Add a member to a team.

**Request Body:**
```json
{
  "email": "user@example.com",
  "role": "member"
}
```

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Invalid request parameters"
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "error": "Insufficient permissions"
}
```

### 429 Too Many Requests
```json
{
  "error": "Rate limit exceeded",
  "resetTime": "2025-04-06T11:00:00Z"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Websocket API

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3000/api/v1/ws');
```

### Events

#### Heartbeat Update
```json
{
  "type": "heartbeat",
  "data": {
    "time": "2025-04-06T10:28:10Z",
    "project": "project-name",
    "duration": 300
  }
}
```

#### Goal Progress
```json
{
  "type": "goal_progress",
  "data": {
    "goalId": "123",
    "progress": 75,
    "remaining": 45
  }
}
```
