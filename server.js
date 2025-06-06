import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { fetchMessages, parseMessages } from './src/messages.js';
import { getNewSessionCodes, fetchGradebook } from './src/auth.js';
import { extractSfGridObjectsFromExtend } from './src/extract.js';
import { parseGradebookRows, annotateGradesWithCourseNames, organizeGradesByCourse } from './src/grades.js';

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_FILE = 'session_codes.json';
const USER = process.env.SKYWARD_USER;
const PASS = process.env.SKYWARD_PASS;
const BASEURL = process.env.SKYWARD_BASEURL;
console.log('BASEURL:', BASEURL);

app.use(cors());
app.use(express.json());

let sessionCodes = null;

// Helper to load or refresh session codes
async function getSessionCodes() {
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

  sessionCodes = await getNewSessionCodes(USER, PASS, BASEURL);
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionCodes, null, 2), 'utf8');
  return sessionCodes;
}

// Endpoint to get grades
app.get('/grades', async (req, res) => {
  try {
    let session = await getSessionCodes();

    let html = await fetchGradebook(BASEURL, session);

    if (html.includes('Your session has expired and you have been logged out.')) {
      session = await getNewSessionCodes(USER, PASS, BASEURL);
      fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
      html = await fetchGradebook(BASEURL, session);
    }

    const gridObjects = extractSfGridObjectsFromExtend(html);
    const gradeGridKey = Object.keys(gridObjects).find(k => k.toLowerCase().includes('stugrades'));
    const gradeGrid = gridObjects[gradeGridKey];
    const simplifiedGrades = parseGradebookRows(gradeGrid.tb.r, html);
    const allTables = parse(html).querySelectorAll('table');
    const annotated = annotateGradesWithCourseNames(simplifiedGrades, allTables);
    const organized = organizeGradesByCourse(annotated);

    res.json(organized);
  } catch (e) {
    console.error('Error fetching grades:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint to get messages
app.post('/messages', async (req, res) => {
  try {
    const { user, pass, baseUrl } = req.body;

    if (!user || !pass || !baseUrl) {
      return res.status(400).json({ error: 'Missing user, pass, or baseUrl in request body' });
    }

    const sessionCodes = await getNewSessionCodes(user, pass, baseUrl);
    const html = await fetchMessages(baseUrl, sessionCodes);
    const messages = parseMessages(html);

    res.json(messages);
  } catch (e) {
    console.error('Error fetching messages:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Skyward backend API listening on port ${PORT}`);
});