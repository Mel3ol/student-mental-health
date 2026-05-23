# Mental Health Check-in System - Complete MVP

## 🎯 Project Overview

A privacy-first, anonymous student mental health check-in system for schools. Students complete anonymous check-ins without providing personal information. Counselors can view anonymized aggregated data and get alerts when patterns suggest a student needs support.

## 📁 Project Structure

```
student-mental-health/
├── backend/
│   ├── server.js                 # Express.js server with all API endpoints
│   ├── package.json              # Node.js dependencies
│   ├── .env.example              # Environment variables template
│   ├── SETUP.md                  # Firebase/database setup guide
│   ├── firebase-key.json         # Firebase credentials (ADD TO .gitignore!)
│   └── public/
│       ├── index.html            # Student check-in page
│       ├── dashboard.html        # Counselor dashboard
│       └── login.html            # Counselor login page
├── scripts/
│   └── cleanup.js                # Data cleanup script (7-day expiration)
├── .gitignore                    # Git ignore file
└── README.md                     # This file

```

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Firebase project (or use local SQLite)
- Git

### 1. Setup Environment

```bash
# Clone repository
git clone https://github.com/Mel3ol/student-mental-health.git
cd student-mental-health

# Copy environment template
cp backend/.env.example backend/.env

# Edit .env with your Firebase credentials
nano backend/.env
```

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Setup Firebase (Recommended)

**Option A: Firebase Firestore (Cloud)**

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project: "Student Mental Health"
3. Enable Firestore Database
4. Generate a Service Account key:
   - Project Settings → Service Accounts → Generate New Private Key
   - Copy the JSON content into `backend/.env` as `FIREBASE_SERVICE_ACCOUNT`
5. Create these collections:
   - `checkins` - Student check-in records
   - `daily_aggregates` - Daily statistics
   - `alerts` - Counselor alerts
   - `contact_requests` - Contact requests

**Option B: Local SQLite**

Modify `backend/server.js` to use SQLite instead (see SETUP.md)

### 4. Run the Server

```bash
# Start development server (with hot reload)
npm run dev

# Server runs on http://localhost:3000
```

### 5. Access the Application

- **Student Check-in:** http://localhost:3000 (or http://localhost:3000/index.html)
- **Counselor Dashboard:** http://localhost:3000/dashboard.html
  - Login page: http://localhost:3000/login.html
  - Default access code (development): `dev-secret-key-change-in-prod`

## 🔐 Security & Privacy

### Privacy Design

- ✅ **No login for students** - Anonymous session IDs stored in browser localStorage
- ✅ **No PII collection** - No names, emails, IP addresses, or device fingerprints
- ✅ **Session-based tracking** - UUID generated per student session
- ✅ **Automatic data expiration** - Check-ins deleted after 7 days via cleanup script
- ✅ **No ID tracking for alerts** - Counselors see patterns, not identities

### For Production Deployment

1. **Change `COUNSELOR_SECRET` in `.env`**
   ```
   COUNSELOR_SECRET=your-very-strong-random-secret-key-here
   ```

2. **Enable HTTPS only**
   - Use environment variable: `NODE_ENV=production`
   - Deploy on Vercel, Railway, or DigitalOcean

3. **Use HTTPS certificates** (Let's Encrypt)

4. **Secure .env file**
   - Add `backend/.env` and `backend/firebase-key.json` to `.gitignore`
   - Never commit secrets to version control

5. **Update login security**
   - Consider Google OAuth for counselor login
   - Implement 2FA for additional protection
   - Use HTTP-only cookies instead of sessionStorage

## 📊 API Endpoints

### Student Check-in

**POST** `/api/checkin`

Submit a check-in without authentication.

```bash
curl -X POST http://localhost:3000/api/checkin \
  -H "Content-Type: application/json" \
  -d '{
    "emoji": "😊",
    "grade_range": "9-10",
    "want_talk": false,
    "free_text": "Feeling good today!",
    "session_id": "uuid-optional"
  }'
```

**Response:**
```json
{
  "success": true,
  "session_id": "uuid-here",
  "message": "Check-in received. Thank you for sharing."
}
```

### Counselor Dashboard (Protected)

All dashboard endpoints require `Authorization: Bearer YOUR_COUNSELOR_SECRET` header.

**GET** `/api/dashboard/stats`

Fetch aggregate statistics by date range and grade.

```bash
curl -H "Authorization: Bearer dev-secret-key-change-in-prod" \
  "http://localhost:3000/api/dashboard/stats?start_date=2026-05-16&end_date=2026-05-23&grade_range=all"
```

**GET** `/api/dashboard/alerts`

Get flagged entries and repeated struggle alerts.

```bash
curl -H "Authorization: Bearer dev-secret-key-change-in-prod" \
  http://localhost:3000/api/dashboard/alerts
```

**GET** `/api/dashboard/contact-requests`

Get students requesting to talk.

```bash
curl -H "Authorization: Bearer dev-secret-key-change-in-prod" \
  http://localhost:3000/api/dashboard/contact-requests
```

**POST** `/api/dashboard/alert/acknowledge`

Mark an alert as acknowledged.

```bash
curl -X POST http://localhost:3000/api/dashboard/alert/acknowledge \
  -H "Authorization: Bearer dev-secret-key-change-in-prod" \
  -H "Content-Type: application/json" \
  -d '{"alert_id": "alert-uuid"}'
```

## 🧹 Maintenance

### Cleanup Old Data

Run the cleanup script to delete check-ins older than 7 days:

```bash
npm run cleanup
```

**Schedule for production (via cron or cloud functions):**

```bash
# Daily at 2 AM
0 2 * * * cd /path/to/project && npm run cleanup
```

Or use Firebase Cloud Scheduler to trigger the cleanup function.

## 📈 Data Model

### Firestore Collections

**`checkins`** - Individual student check-ins
```
{
  session_id: "uuid",
  timestamp: Timestamp,
  emoji: "😊" | "😐" | "😞",
  grade_range: "9-10" | "11-12" | null,
  want_talk: boolean,
  free_text: string,
  flagged: boolean,  // Contains sensitive keywords
  created_at: Timestamp
}
```

**`daily_aggregates`** - Aggregated daily stats
```
{
  date: "2026-05-23",
  grade_range: "9-10" | "11-12" | "all",
  good_count: number,
  okay_count: number,
  struggling_count: number,
  updated_at: Timestamp
}
```

**`alerts`** - Non-identifiable alerts for counselors
```
{
  type: "repeated_struggle",
  message: "A student has reported struggling for 3 days in a row...",
  created_at: Timestamp,
  acknowledged: boolean,
  acknowledged_at: Timestamp
}
```

**`contact_requests`** - Students wanting to talk
```
{
  session_id: "uuid",
  emoji: "😊" | "😐" | "😞",
  grade_range: "9-10" | "11-12" | null,
  timestamp: Timestamp,
  created_at: Timestamp
}
```

## 🔄 Workflow

### Student Flow

1. Student visits http://localhost:3000
2. Selects mood emoji (😊, 😐, 😞)
3. Optionally provides grade range
4. Chooses if they want to talk to someone
5. Optionally writes anonymous note
6. Submits check-in
7. Sees thank-you message with crisis hotline + counselor email
8. Check-in stored anonymously in database

### Counselor Flow

1. Counselor visits http://localhost:3000/login.html
2. Enters access code
3. Views dashboard with:
   - 7/30-day trends (line chart)
   - Overall distribution (pie chart)
   - Alerts when students struggle 3+ days
   - Flagged text entries with sensitive keywords
   - Anonymous contact requests
4. Can filter by date range and grade
5. Acknowledges alerts to mark as reviewed

## 🎨 Features

✅ Anonymous check-ins (no PII)
✅ Three-emoji quick mood selection
✅ Optional grade range tracking
✅ Optional text field (sanitized for profanity)
✅ Keyword flagging (suicide, hurt, abuse, etc.)
✅ 3-day struggle pattern detection
✅ Aggregate analytics dashboard
✅ Crisis hotline resources
✅ Mobile-responsive design
✅ 7-day automatic data expiration
✅ Password-protected counselor access
✅ Chart.js visualizations

## 🚀 Deployment Options

### Vercel (Recommended for Node.js)

```bash
npm install -g vercel
cd backend
vercel
```

### Railway

```bash
# Connect GitHub repo to Railway
# Set environment variables in Railway dashboard
# Deploy from Git
```

### DigitalOcean

```bash
# Create App Platform project
# Connect GitHub repo
# Set PORT=3000 in environment
```

### Docker

```dockerfile
FROM node:18
WORKDIR /app
COPY backend/ .
RUN npm install
EXPOSE 3000
CMD ["npm", "start"]
```

## 📚 Additional Resources

- [Firebase Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Express.js Guide](https://expressjs.com/)
- [Chart.js Documentation](https://www.chartjs.org/)
- [Crisis Text Line](https://www.crisistextline.org/)
- [SAMHSA National Helpline](https://www.samhsa.gov/find-help/national-helpline)

## 📝 License

This project is open source and available under the MIT License.

## 🤝 Contributing

To contribute to this project:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## ⚠️ Important Notes

- **This is an MVP** - Additional security hardening needed before production
- **Counselor auth is simple** - Consider OAuth or 2FA for schools with multiple counselors
- **Test thoroughly** - Especially privacy and data retention features
- **Privacy compliance** - Ensure compliance with FERPA, COPPA, and local laws
- **School district approval** - Get IT/admin approval before deployment

---

**Built with ❤️ for student mental health**
