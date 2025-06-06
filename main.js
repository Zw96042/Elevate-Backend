import { fetchAllMessages, parseMessages } from './src/messages.js';
import 'dotenv/config';
import fs from 'fs';
import { parse } from 'node-html-parser';
import { getNewSessionCodes, fetchGradebook } from './src/auth.js';
import { extractSfGridObjectsFromExtend } from './src/extract.js';
import { parseGradebookRows, annotateGradesWithCourseNames, organizeGradesByCourse } from './src/grades.js';

const MODE = process.argv[2] || 'grades'; // can be 'grades' or 'messages'
const SESSION_FILE = 'session_codes.json';

(async () => {
  const user = process.env.SKYWARD_USER;
  const pass = process.env.SKYWARD_PASS;
  const baseURL = process.env.SKYWARD_BASEURL;

  let sessionCodes = null;

  if (fs.existsSync(SESSION_FILE)) {
    try {
      const raw = fs.readFileSync(SESSION_FILE, 'utf8');
      sessionCodes = JSON.parse(raw);
      console.log('Loaded session codes from file.');
    } catch {
      sessionCodes = null;
    }
  }

  try {
    if (!sessionCodes) throw new Error("No session codes loaded.");

    let html;
    if (MODE === 'grades') {
      html = await fetchGradebook(baseURL, sessionCodes);
    } else {
      html = await fetchAllMessages(baseURL, sessionCodes);
    }

    if (html.includes('Your session has expired and you have been logged out.')) {
      throw new Error('Session expired');
    }

    await handleHtml(MODE, html, baseURL, sessionCodes);
  } catch (err) {
    console.warn('Session expired. Re-authenticating...');
    sessionCodes = await getNewSessionCodes(user, pass, baseURL);
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionCodes, null, 2), 'utf8');

    const html = MODE === 'grades'
      ? await fetchGradebook(baseURL, sessionCodes)
      : await fetchAllMessages(baseURL, sessionCodes);

    await handleHtml(MODE, html, baseURL, sessionCodes);
  }
})();

async function handleHtml(mode, html, baseURL, sessionCodes) {
  if (mode === 'grades') {
    const gridObjects = extractSfGridObjectsFromExtend(html);
    const gradeGridKey = Object.keys(gridObjects).find(k => k.toLowerCase().includes('stugrades'));
    const gradeGrid = gridObjects[gradeGridKey];
    const simplifiedGrades = parseGradebookRows(gradeGrid.tb.r, html);
    const allTables = parse(html).querySelectorAll('table');
    const annotated = annotateGradesWithCourseNames(simplifiedGrades, allTables);
    const organized = organizeGradesByCourse(annotated);
    fs.writeFileSync('organized_grades_by_course.json', JSON.stringify(organized, null, 2));
  } else {
    fs.writeFileSync('raw_messages.html', html, 'utf8');
    const messages = parseMessages(html);
    console.log(`Parsed ${messages.length} messages.`);
    fs.writeFileSync('parsed_messages.json', JSON.stringify(messages, null, 2));
  }
}