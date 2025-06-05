// main.js
import 'dotenv/config';
import fs from 'fs';
import { parse } from 'node-html-parser';
import { getNewSessionCodes, fetchGradebook } from './src/auth.js';
import { extractSfGridObjectsFromExtend } from './src/extract.js';
import { parseGradebookRows, annotateGradesWithCourseNames, organizeGradesByCourse } from './src/grades.js';

const SESSION_FILE = 'session_codes.json';

(async () => {
  const user = process.env.SKYWARD_USER;
  const pass = process.env.SKYWARD_PASS;
  const baseURL = process.env.SKYWARD_BASEURL;

  let sessionCodes = null;

  // Try reading session codes from file
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const raw = fs.readFileSync(SESSION_FILE, 'utf8');
      sessionCodes = JSON.parse(raw);
      console.log('Loaded session codes from file.');
    } catch (err) {
      console.warn('Failed to parse session codes file. Regenerating.');
      sessionCodes = null;
    }
  }

  let gradebookHtml = null;
  try {
    if (!sessionCodes) throw new Error("No session codes loaded.");
    gradebookHtml = await fetchGradebook(baseURL, sessionCodes);
    if (gradebookHtml.includes('Your session has expired and you have been logged out.')) {
      throw new Error('Session expired');
    }
  } catch (err) {
    console.warn('Existing session codes failed. Logging in again...');
    sessionCodes = await getNewSessionCodes(user, pass, baseURL);
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionCodes, null, 2), 'utf8');
    gradebookHtml = await fetchGradebook(baseURL, sessionCodes);
  }

  console.log('Fetched gradebook HTML length:', gradebookHtml.length);
  fs.writeFileSync('gradebook_full.html', gradebookHtml);
  console.log('Saved full gradebook HTML to gradebook_full.html');

  const gridObjects = extractSfGridObjectsFromExtend(gradebookHtml);
  if (!gridObjects) {
    console.log("No sf_gridObjects data extracted.");
    return;
  }

  console.log(`Extracted sf_gridObjects: [${Object.keys(gridObjects).join(', ')}]`);

  const gradeGridKey = Object.keys(gridObjects).find(k => k.toLowerCase().includes('stugrades'));
  if (!gradeGridKey) {
    console.log("No grade/assignment grid key found in sf_gridObjects.");
    return;
  }

  const gradeGrid = gridObjects[gradeGridKey];
  if (!gradeGrid.tb || !gradeGrid.tb.r) {
    console.log("No table body rows found in grade grid.");
    return;
  }

  const simplifiedGrades = parseGradebookRows(gradeGrid.tb.r, gradebookHtml);
  const parsedRoot = parse(gradebookHtml);
  const allTables = parsedRoot.querySelectorAll('table');
  const annotatedGrades = annotateGradesWithCourseNames(simplifiedGrades, allTables);
  const organizedGrades = organizeGradesByCourse(annotatedGrades);

  fs.writeFileSync('organized_grades_by_course.json', JSON.stringify(organizedGrades, null, 2), 'utf8');
  console.log('Saved organized grades by course to organized_grades_by_course.json');
})();