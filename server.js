import express from 'express';
import cors from 'cors';
import fs from 'fs';
import 'dotenv/config';
import { fetchAllMessages, parseMessages, fetchMessagesAfterId } from './src/messages.js';
import { getNewSessionCodes, fetchGradebook } from './src/auth.js';
import { extractSfGridObjectsFromExtend } from './src/extract.js';
import { parseGradebookRows, annotateGradesWithCourseNames, organizeGradesByCourse } from './src/grades.js';
import { parse } from 'node-html-parser';

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_FILE = 'session_codes.json';

app.use(cors());
app.use(express.json());  // Parse JSON request bodies

let sessionCodes = null;



// Load session codes if available
async function loadSessionCodes() {
  if (sessionCodes) return sessionCodes;
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const raw = fs.readFileSync(SESSION_FILE, 'utf8');
      sessionCodes = JSON.parse(raw);
      return sessionCodes;
    } catch {
      sessionCodes = null;
    }
  }
  return null;
}

// Save session codes to file
async function saveSessionCodes(codes) {
  sessionCodes = codes;
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionCodes, null, 2), 'utf8');
}

// Authenticate and get new session codes
async function authenticate(user, pass, baseUrl) {
  const codes = await getNewSessionCodes(user, pass, baseUrl);
  await saveSessionCodes(codes);
  return codes;
}

// Get valid session, authenticate if needed
async function getValidSession(user, pass, baseUrl) {
  let codes = await loadSessionCodes();
  if (!codes) {
    codes = await authenticate(user, pass, baseUrl);
  }
  return codes;
}

// Auth endpoint
app.post('/auth', async (req, res) => {
  try {
    
    const { user, pass, baseUrl } = req.body;
    const now = new Date();
    console.log("Auth request for", user, "at", now.toLocaleString());

    if (!user || !pass || !baseUrl) {
      return res.status(400).json({ error: 'Missing user, pass, or baseUrl in request body' });
    }

    const codes = await authenticate(user, pass, baseUrl);
    console.log(codes);
    res.json(codes);
  } catch (err) {
    console.error('Error authenticating:', err);
    res.status(500).json({ error: err.message });
  }
});

// Grades endpoint
app.get('/grades', async (req, res) => {
  try {
    const now = new Date();
    console.log("Grade request at", now.toLocaleString());
    const user = process.env.SKYWARD_USER;
    const pass = process.env.SKYWARD_PASS;
    const baseUrl = process.env.SKYWARD_BASEURL;

    let codes = await getValidSession(user, pass, baseUrl);
    let html = await fetchGradebook(baseUrl, codes);

    if (html.includes('Your session has expired and you have been logged out.')) {
      codes = await authenticate(user, pass, baseUrl);
      html = await fetchGradebook(baseUrl, codes);
    }

    const gridObjects = extractSfGridObjectsFromExtend(html);
    const gradeGridKey = Object.keys(gridObjects).find(k => k.toLowerCase().includes('stugrades'));
    const gradeGrid = gridObjects[gradeGridKey];
    const simplifiedGrades = parseGradebookRows(gradeGrid.tb.r, html);
    const allTables = parse(html).querySelectorAll('table');
    const annotated = annotateGradesWithCourseNames(simplifiedGrades, allTables);
    const organized = organizeGradesByCourse(annotated);

    res.json(organized);
  } catch (err) {
    console.error('Error fetching grades:', err);
    res.status(500).json({ error: err.message });
  }
});

// Messages endpoint - updated to accept session codes instead of user/pass
app.post('/messages', async (req, res) => {
  try {
    const now = new Date();
    console.log("Initial message request at", now.toLocaleString());
    const { dwd, encses, sessionid, wfaacl, baseUrl, 'User-Type': userType } = req.body;

    if (!dwd || !encses || !sessionid || !wfaacl || !baseUrl) {
      return res.status(400).json({ error: 'Missing session credentials or baseUrl in request body' });
    }

    const codes = { dwd, encses, sessionid, wfaacl, 'User-Type': userType || '2' };

    const html = await fetchAllMessages(baseUrl, codes);

    if (html.includes('Your session has expired and you have been logged out.')) {
      throw new Error('Session expired');
    }

    const messages = parseMessages(html);
    res.json(messages);
  } catch (err) {
    if (err.message.includes('Session expired')) {
        // throw new Error("Session Expired");
      res.status(401).send({ error: 'Session expired. Please authenticate again.' });
    } else {
        // throw err;
      res.status(500).send({ error: err.message });
    }
  }
});

app.post('/next-messages', async (req, res) => {
  try {
    const now = new Date();
    console.log("More message request at", now.toLocaleString());
    const { dwd, encses, sessionid, wfaacl, baseUrl, 'User-Type': userType, lastMessageId, limit } = req.body;

    if (!dwd || !encses || !sessionid || !wfaacl || !baseUrl || !lastMessageId) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }

    const codes = { dwd, encses, sessionid, wfaacl, 'User-Type': userType || '2' };

    const messages = await fetchMessagesAfterId(baseUrl, codes, lastMessageId, limit || 10);

    res.json(messages);
  } catch (err) {
    if (err.message.includes('Session expired')) {
        // throw new Error("Session Expired");
      res.status(401).send({ error: 'Session expired. Please authenticate again.' });
    } else {
        // throw err;
      res.status(500).send({ error: err.message });
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Skyward backend API listening on port ${PORT}`);
});