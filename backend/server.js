// ============================================================================
// STUDENT MENTAL HEALTH CHECK-IN: EXPRESS SERVER
// Privacy-first, anonymous check-in system for schools
// ============================================================================

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { filter } from 'better-profanity';

dotenv.config();

const app = express();

// ============================================================================
// CONFIGURATION & MIDDLEWARE
// ============================================================================

// CORS for frontend communication
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Firebase Admin SDK initialization
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

// Counselor authentication (simple Bearer token)
const COUNSELOR_SECRET = process.env.COUNSELOR_SECRET || 'dev-secret-key-change-in-prod';

// Keywords that trigger flagging (student mentions sensitive topics)
const FLAGGED_KEYWORDS = [
  'hurt',
  'pain',
  'hopeless',
  'suicide',
  'suicidal',
  'cut',
  'cutting',
  'die',
  'death',
  'kill myself',
  'end it',
  'overdose',
  'overdosed',
  'abuse',
  'assault',
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if free-text contains flagged keywords
 */
function containsFlaggedKeywords(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return FLAGGED_KEYWORDS.some((keyword) => lowerText.includes(keyword));
}

/**
 * Sanitize user input (remove profanity)
 */
function sanitizeText(text) {
  if (!text) return '';
  return filter(text);
}

/**
 * Verify counselor authentication
 */
function verifyCounselorAuth(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return false;
  }
  const token = authHeader.substring(7);
  if (token !== COUNSELOR_SECRET) {
    res.status(403).json({ error: 'Invalid credentials' });
    return false;
  }
  return true;
}

/**
 * Get or create session ID for a student
 */
function getSessionId(req) {
  // In real scenario, this would come from client's localStorage
  // For now, we generate a new one each time a check-in is submitted
  return uuidv4();
}

// ============================================================================
// ROUTES: STUDENT CHECK-IN
// ============================================================================

/**
 * POST /api/checkin
 * Receive student check-in data
 * Body: {
 *   emoji: "😊" | "😐" | "😞",
 *   grade_range: "9-10" | "11-12" (optional),
 *   want_talk: boolean,
 *   free_text: string (optional),
 *   session_id: string (optional, generated if not provided)
 * }
 */
app.post('/api/checkin', async (req, res) => {
  try {
    const { emoji, grade_range, want_talk, free_text, session_id } = req.body;

    // Validation
    if (!emoji || !['😊', '😐', '😞'].includes(emoji)) {
      return res.status(400).json({ error: 'Invalid emoji' });
    }

    const finalSessionId = session_id || uuidv4();
    const sanitizedText = free_text ? sanitizeText(free_text) : '';
    const isFlagged = containsFlaggedKeywords(sanitizedText);

    // Create check-in document
    const checkinRef = db.collection('checkins').doc();
    const now = new Date();

    await checkinRef.set({
      session_id: finalSessionId,
      timestamp: now,
      emoji,
      grade_range: grade_range || null,
      want_talk: want_talk || false,
      free_text: sanitizedText,
      flagged: isFlagged,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store aggregate data for dashboard (emoji counts per day)
    await updateDailyAggregate(emoji, grade_range);

    // Check for repeated struggling pattern (same session reporting 😞 for 3+ days)
    await checkStruggleAlert(finalSessionId, emoji);

    // If student wants to talk, log for counselor review
    if (want_talk) {
      await db.collection('contact_requests').doc().set({
        session_id: finalSessionId,
        emoji,
        grade_range: grade_range || null,
        timestamp: now,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return res.status(201).json({
      success: true,
      session_id: finalSessionId,
      message: 'Check-in received. Thank you for sharing.',
    });
  } catch (error) {
    console.error('Error in /api/checkin:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update daily aggregate stats (good/okay/struggling counts)
 */
async function updateDailyAggregate(emoji, grade_range) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const gradeKey = grade_range || 'all';

  const docId = `${dateKey}-${gradeKey}`;
  const docRef = db.collection('daily_aggregates').doc(docId);

  await docRef.set(
    {
      date: dateKey,
      grade_range: gradeKey,
      [emoji === '😊' ? 'good_count' : emoji === '😐' ? 'okay_count' : 'struggling_count']: admin.firestore.FieldValue.increment(1),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Check if same session has reported struggling for 3+ consecutive days
 */
async function checkStruggleAlert(sessionId, emoji) {
  if (emoji !== '😞') return; // Only track struggling reports

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const snapshot = await db
    .collection('checkins')
    .where('session_id', '==', sessionId)
    .where('emoji', '==', '😞')
    .where('timestamp', '>=', threeDaysAgo)
    .orderBy('timestamp', 'desc')
    .limit(3)
    .get();

  if (snapshot.size >= 3) {
    // Alert counselor: A student is struggling consistently
    // Don't store session_id to maintain anonymity
    await db.collection('alerts').doc().set({
      type: 'repeated_struggle',
      message: 'A student has reported struggling for 3 days in a row. Please consider posting general support resources.',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      acknowledged: false,
    });
  }
}

// ============================================================================
// ROUTES: COUNSELOR DASHBOARD (Protected)
// ============================================================================

/**
 * GET /api/dashboard/stats
 * Return aggregate statistics for a date range
 * Query params: start_date, end_date (YYYY-MM-DD), grade_range (optional)
 */
app.get('/api/dashboard/stats', async (req, res) => {
  if (!verifyCounselorAuth(req, res)) return;

  try {
    const { start_date, end_date, grade_range } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date required (YYYY-MM-DD)' });
    }

    const gradeKey = grade_range || 'all';

    // Fetch all aggregates in date range
    let query = db
      .collection('daily_aggregates')
      .where('date', '>=', start_date)
      .where('date', '<=', end_date)
      .where('grade_range', '==', gradeKey)
      .orderBy('date');

    const snapshot = await query.get();

    const stats = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      stats.push({
        date: data.date,
        good: data.good_count || 0,
        okay: data.okay_count || 0,
        struggling: data.struggling_count || 0,
      });
    });

    return res.json({ success: true, stats });
  } catch (error) {
    console.error('Error in /api/dashboard/stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/dashboard/alerts
 * Return non-identifiable alerts (flagged entries, repeated struggle patterns)
 */
app.get('/api/dashboard/alerts', async (req, res) => {
  if (!verifyCounselorAuth(req, res)) return;

  try {
    // Fetch flagged check-ins (anonymized)
    const flaggedSnapshot = await db
      .collection('checkins')
      .where('flagged', '==', true)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const flaggedEntries = [];
    flaggedSnapshot.forEach((doc) => {
      const data = doc.data();
      flaggedEntries.push({
        id: doc.id,
        emoji: data.emoji,
        text: data.free_text,
        grade_range: data.grade_range || 'Not provided',
        timestamp: data.timestamp,
      });
    });

    // Fetch struggle alerts
    const alertsSnapshot = await db
      .collection('alerts')
      .where('type', '==', 'repeated_struggle')
      .where('acknowledged', '==', false)
      .orderBy('created_at', 'desc')
      .get();

    const alerts = [];
    alertsSnapshot.forEach((doc) => {
      alerts.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    return res.json({
      success: true,
      flagged_entries: flaggedEntries,
      struggle_alerts: alerts,
    });
  } catch (error) {
    console.error('Error in /api/dashboard/alerts:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/dashboard/contact-requests
 * Return anonymous contact requests (students who want to talk)
 */
app.get('/api/dashboard/contact-requests', async (req, res) => {
  if (!verifyCounselorAuth(req, res)) return;

  try {
    const snapshot = await db
      .collection('contact_requests')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const requests = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      requests.push({
        id: doc.id,
        emoji: data.emoji,
        grade_range: data.grade_range || 'Not provided',
        timestamp: data.timestamp,
      });
    });

    return res.json({ success: true, requests });
  } catch (error) {
    console.error('Error in /api/dashboard/contact-requests:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/dashboard/alert/acknowledge
 * Mark an alert as acknowledged
 */
app.post('/api/dashboard/alert/acknowledge', async (req, res) => {
  if (!verifyCounselorAuth(req, res)) return;

  try {
    const { alert_id } = req.body;

    if (!alert_id) {
      return res.status(400).json({ error: 'alert_id required' });
    }

    await db.collection('alerts').doc(alert_id).update({
      acknowledged: true,
      acknowledged_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, message: 'Alert acknowledged' });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Mental Health Check-in Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard available at http://localhost:${PORT}/dashboard.html`);
});
