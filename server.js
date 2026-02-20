import express from 'express';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercel = Boolean(process.env.VERCEL);

const app = express();
const port = Number(process.env.PORT || 3000);
const calendarId = process.env.CALENDAR_ID;
const timezone = process.env.TIMEZONE || 'Asia/Tokyo';
const workStartHour = Number(process.env.WORK_START_HOUR || 8);
const workEndHour = Number(process.env.WORK_END_HOUR || 18);
const defaultSlotMinutes = Number(process.env.SLOT_MINUTES || 30);
const proposalsPath = process.env.PROPOSALS_PATH
  || (isVercel ? '/tmp/proposals.json' : path.join(__dirname, 'data', 'proposals.json'));
const notifyTo = process.env.NOTIFY_TO || 'yamasaki586868@gmail.com';
const corsOrigin = process.env.CORS_ORIGIN || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

async function sendProposalNotification(record) {
  const transport = getMailTransport();
  if (!transport) {
    throw new Error('SMTP is not configured');
  }

  const submittedAtJst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short'
  }).format(new Date(record.submittedAt));

  const lines = formatSuggestionLines(record.slotSuggestions);

  const text = [
    '新しい候補提案が届きました。',
    '',
    `ID: ${record.id}`,
    `送信日時: ${submittedAtJst}（日本時間）`,
    `お名前: ${record.name}`,
    `メール: ${record.email}`,
    `補足: ${record.note || '(なし)'}`,
    '',
    '候補時間:',
    lines
  ].join('\n');

  await transport.sendMail({
    from: process.env.MAIL_FROM || userFromAddress(process.env.SMTP_USER),
    to: notifyTo,
    replyTo: record.email,
    subject: `[空き枠提案] ${record.name} さんから候補が届きました`,
    text
  });
  return { sent: true };
}

async function sendProposalAcknowledgement(record) {
  const transport = getMailTransport();
  if (!transport) {
    throw new Error('SMTP is not configured');
  }

  const submittedAtJst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short'
  }).format(new Date(record.submittedAt));

  const lines = formatSuggestionLines(record.slotSuggestions);

  const text = [
    `${record.name} 様`,
    '',
    '候補時間をご送信いただきありがとうございます。',
    '以下の内容で受け付けました。',
    '',
    `受付日時: ${submittedAtJst}（日本時間）`,
    '',
    '候補時間:',
    lines,
    '',
    '内容を確認のうえ、別途ご連絡いたします。',
    'どうぞよろしくお願いいたします。'
  ].join('\n');

  await transport.sendMail({
    from: process.env.MAIL_FROM || userFromAddress(process.env.SMTP_USER),
    to: record.email,
    subject: '【受付完了】候補時間を受け付けました',
    text
  });

  return { sent: true };
}

function userFromAddress(user) {
  return user || 'no-reply@example.com';
}

function formatSuggestionLines(slotSuggestions) {
  return slotSuggestions
    .map((s, idx) => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      const day = start.toLocaleDateString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
      });
      const from = start.toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit'
      });
      const to = end.toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${idx + 1}. ${day} ${from} - ${to}`;
    })
    .join('\n');
}

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  }

  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
  });
}

function toDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function getCalendarClient() {
  if (!calendarId) {
    throw new Error('CALENDAR_ID is not configured');
  }
  const auth = getAuthClient();
  return google.calendar({ version: 'v3', auth });
}

function buildSlots({ start, end, busy, slotMinutes }) {
  const slots = [];
  const busyRanges = busy
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((b) => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()))
    .sort((a, b) => a.start - b.start);

  const mergedBusy = [];
  for (const range of busyRanges) {
    if (!mergedBusy.length || range.start > mergedBusy[mergedBusy.length - 1].end) {
      mergedBusy.push({ ...range });
      continue;
    }
    const last = mergedBusy[mergedBusy.length - 1];
    if (range.end > last.end) last.end = range.end;
  }

  let cursor = new Date(start);
  while (cursor < end) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const dayStart = new Date(cursor);
    dayStart.setHours(workStartHour, 0, 0, 0);

    const dayEnd = new Date(cursor);
    dayEnd.setHours(workEndHour, 0, 0, 0);

    const scanStart = dayStart > start ? dayStart : new Date(start);
    const scanEnd = dayEnd < end ? dayEnd : new Date(end);

    if (scanStart < scanEnd) {
      let slotStart = new Date(scanStart);
      while (slotStart < scanEnd) {
        const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60_000);
        if (slotEnd > scanEnd) break;

        const overlaps = mergedBusy.some((b) => b.start < slotEnd && b.end > slotStart);
        if (!overlaps) {
          slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
        }
        slotStart = slotEnd;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return slots;
}

function buildFreeIntervals({ start, end, busy }) {
  const intervals = [];
  const busyRanges = busy
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((b) => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()))
    .sort((a, b) => a.start - b.start);

  let cursorDay = new Date(start);
  cursorDay.setHours(0, 0, 0, 0);

  while (cursorDay < end) {
    const dayOfWeek = cursorDay.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const dayStart = new Date(cursorDay);
      dayStart.setHours(workStartHour, 0, 0, 0);
      const dayEnd = new Date(cursorDay);
      dayEnd.setHours(workEndHour, 0, 0, 0);

      const windowStart = dayStart > start ? dayStart : new Date(start);
      const windowEnd = dayEnd < end ? dayEnd : new Date(end);

      if (windowStart < windowEnd) {
        const overlappedBusy = busyRanges
          .map((r) => ({
            start: r.start > windowStart ? r.start : windowStart,
            end: r.end < windowEnd ? r.end : windowEnd
          }))
          .filter((r) => r.start < r.end)
          .sort((a, b) => a.start - b.start);

        let freeCursor = new Date(windowStart);
        for (const range of overlappedBusy) {
          if (range.start > freeCursor) {
            intervals.push({
              start: freeCursor.toISOString(),
              end: range.start.toISOString()
            });
          }
          if (range.end > freeCursor) {
            freeCursor = new Date(range.end);
          }
        }

        if (freeCursor < windowEnd) {
          intervals.push({
            start: freeCursor.toISOString(),
            end: windowEnd.toISOString()
          });
        }
      }
    }

    cursorDay.setDate(cursorDay.getDate() + 1);
  }

  return intervals;
}

app.get('/api/availability', async (req, res) => {
  try {
    const start = toDate(req.query.start) || new Date();
    const end = toDate(req.query.end) || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const slotMinutes = Number(req.query.slotMinutes || defaultSlotMinutes);

    if (end <= start) {
      return res.status(400).json({ error: 'end must be later than start' });
    }
    if (slotMinutes < 15 || slotMinutes > 180) {
      return res.status(400).json({ error: 'slotMinutes must be between 15 and 180' });
    }

    const calendar = await getCalendarClient();

    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: timezone,
        items: [{ id: calendarId }]
      }
    });

    const busy = fb.data.calendars?.[calendarId]?.busy || [];
    const slots = buildSlots({ start, end, busy, slotMinutes });

    res.json({
      calendarId,
      timezone,
      slotMinutes,
      start: start.toISOString(),
      end: end.toISOString(),
      slots
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch availability' });
  }
});

app.get('/api/free-intervals', async (req, res) => {
  try {
    const start = toDate(req.query.start) || new Date();
    const end = toDate(req.query.end) || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (end <= start) {
      return res.status(400).json({ error: 'end must be later than start' });
    }

    const calendar = await getCalendarClient();
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: timezone,
        items: [{ id: calendarId }]
      }
    });

    const busy = fb.data.calendars?.[calendarId]?.busy || [];
    const intervals = buildFreeIntervals({ start, end, busy });
    res.json({
      calendarId,
      timezone,
      start: start.toISOString(),
      end: end.toISOString(),
      intervals
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch free intervals' });
  }
});

function normalizeEvent(item) {
  return {
    id: item.id || '',
    summary: item.summary || '(タイトルなし)',
    start: item.start?.dateTime || item.start?.date || '',
    end: item.end?.dateTime || item.end?.date || '',
    isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
    status: item.status || 'confirmed',
    htmlLink: item.htmlLink || ''
  };
}

app.get('/api/calendar-events', async (req, res) => {
  try {
    const start = toDate(req.query.start) || new Date();
    const end = toDate(req.query.end) || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (end <= start) {
      return res.status(400).json({ error: 'end must be later than start' });
    }

    const calendar = await getCalendarClient();
    const result = await calendar.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    });

    const events = (result.data.items || [])
      .filter((item) => item.status !== 'cancelled')
      .map(normalizeEvent);

    res.json({
      calendarId,
      timezone,
      start: start.toISOString(),
      end: end.toISOString(),
      events
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch events' });
  }
});

async function ensureProposalsFile() {
  try {
    await fs.access(proposalsPath);
  } catch {
    await fs.writeFile(proposalsPath, '[]', 'utf8');
  }
}

app.post('/api/proposals', async (req, res) => {
  try {
    await ensureProposalsFile();

    const { name, email, note, slotSuggestions } = req.body || {};
    if (!name || !email || !Array.isArray(slotSuggestions) || slotSuggestions.length === 0) {
      return res.status(400).json({ error: 'name, email and slotSuggestions are required' });
    }

    const record = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      name: String(name).trim(),
      email: String(email).trim(),
      note: note ? String(note).trim() : '',
      slotSuggestions: slotSuggestions
        .slice(0, 10)
        .map((s) => ({ start: String(s.start), end: String(s.end) }))
    };

    const mailStatus = await sendProposalNotification(record);
    const acknowledgementStatus = await sendProposalAcknowledgement(record);

    const raw = await fs.readFile(proposalsPath, 'utf8');
    const list = JSON.parse(raw);
    list.push(record);
    await fs.writeFile(proposalsPath, JSON.stringify(list, null, 2), 'utf8');

    res.status(201).json({
      ok: true,
      id: record.id,
      mail: mailStatus,
      acknowledgement: acknowledgementStatus
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save proposal' });
  }
});

app.get('/api/proposals', async (_req, res) => {
  try {
    await ensureProposalsFile();
    const raw = await fs.readFile(proposalsPath, 'utf8');
    const list = JSON.parse(raw);
    res.json({ proposals: list });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load proposals' });
  }
});

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

export default app;
