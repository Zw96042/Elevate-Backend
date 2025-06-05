import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parse } from 'node-html-parser';
import JSON5 from 'json5';

const SESSION_FILE = 'session_codes.json';

/**
 * Extract the JSON object from sff.sv('sf_gridObjects', $.extend(..., {...}));
 * 
 * @param {string} html - The HTML string containing the sff.sv call.
 * @returns {Object|null} The parsed JSON object or null if not found or parsing failed.
 */
function extractSfGridObjectsFromExtend(html) {
  const pattern = /sff\.sv\('sf_gridObjects',\s*\$\.extend\(\s*\(.*?\),\s*(\{[\s\S]*?\})\s*\)\s*\);/m;
  const match = html.match(pattern);
  if (!match) {
    console.log("No sf_gridObjects $.extend data found.");
    return null;
  }

  let objStr = match[1];

  // Remove trailing commas that break JSON parsing
  objStr = objStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  try {
    const data = JSON5.parse(objStr);
    return data;
  } catch (err) {
    console.error("Failed to parse sf_gridObjects $.extend JSON5:", err);
    return null;
  }
}

/**
 * Parse grades grouped by group-parent attribute from stuGradesGrid rows.
 * Returns an array of simplified grade entries: { groupParent, bucket, grade }
 * 
 * @param {Array} rows - The rows array from the grade grid data.
 * @param {string} html - The full gradebook HTML string.
 * @returns {Array} Array of objects with groupParent, bucket, and grade properties.
 */
function parseGradebookRows(rows, html) {
  const root = parse(html);
  const coursesMap = {};
  const groupParentToCourseMap = {};

  // Build a map of group-parent to course name from the root document
  const allCourseRows = root.querySelectorAll('tr[group-parent]');
  for (const tr of allCourseRows) {
    const groupParent = tr.getAttribute('group-parent');
    const classDescSpan = tr.querySelector('span.classDesc');
    const courseLink = classDescSpan ? classDescSpan.querySelector('a') : tr.querySelector('a');
    const courseName = courseLink ? courseLink.text.trim() : null;
    if (groupParent && courseName) {
      groupParentToCourseMap[groupParent] = courseName;
    }
  }

  for (const row of rows) {
    const rowRoot = parse(row.h);
    const tr = rowRoot.querySelector('tr');
    const groupParent = tr ? tr.getAttribute('group-parent') : null;
    if (!groupParent) continue;

    if (!coursesMap[groupParent]) {
      coursesMap[groupParent] = {
        course: groupParentToCourseMap[groupParent] || null,
        grades: []
      };
    }

    if (!row.c || !Array.isArray(row.c)) continue;

    for (const cell of row.c) {
      if (!cell.h) continue;
      const cellRoot = parse(cell.h);
      const anchor = cellRoot.querySelector('a#showGradeInfo');
      if (anchor) {
        coursesMap[groupParent].grades.push({
          grade: anchor.text.trim(),
          bucket: anchor.getAttribute('data-bkt')
        });
      }
    }
  }

  // Flatten to array of { groupParent, bucket, grade }
  const simplifiedGrades = [];
  for (const groupParent in coursesMap) {
    const courseEntry = coursesMap[groupParent];
    for (const gradeEntry of courseEntry.grades) {
      simplifiedGrades.push({
        groupParent,
        bucket: gradeEntry.bucket,
        grade: gradeEntry.grade
      });
    }
  }

  return simplifiedGrades;
}

// Cache for courseID -> courseName
const courseNameCache = new Map();

/**
 * Normalize an ID string by converting to lowercase and removing underscores.
 * 
 * @param {string} id - The ID string to normalize.
 * @returns {string} The normalized ID string.
 */
function normalizeId(id) {
  return id.toLowerCase().replace(/_/g, '');
}

/**
 * Finds course name by courseID by searching tables whose ID contains courseID (normalized, case-insensitive).
 * Uses cache to avoid repeated lookups.
 * Also searches for anchor elements more flexibly and logs missing course names.
 * 
 * @param {string} courseID - The course ID to find.
 * @param {Array<Element>} tables - Parsed table elements from gradebook root HTML.
 * @returns {string} The course name if found, otherwise an empty string.
 */
function findCourseName(courseID, tables) {
  const normalizedID = normalizeId(courseID);
  if (courseNameCache.has(courseID)) {
    return courseNameCache.get(courseID);
  }

  for (const table of tables) {
    const tableId = table.getAttribute('id') || '';
    const normalizedTableId = normalizeId(tableId);
    if (normalizedTableId.includes(normalizedID)) {
      // Search for anchor anywhere inside the table
      let courseName = null;
      const anchors = table.querySelectorAll('a');
      for (const a of anchors) {
        const text = a.text.trim();
        if (text && text.length > 0) {
          courseName = text;
          break;
        }
      }
      if (courseName) {
        courseNameCache.set(courseID, courseName);
        return courseName;
      }
    }
  }

  console.warn(`Course name not found for courseID: ${courseID}`);
  courseNameCache.set(courseID, '');
  return '';
}

/**
 * Annotates grades with their course names by looking up courseID in tables.
 * 
 * @param {Array} simplifiedGrades - Array of grades with groupParent IDs.
 * @param {Array<Element>} allTables - Parsed table elements from root HTML.
 * @returns {Array} Array of grades annotated with courseName property.
 */
function annotateGradesWithCourseNames(simplifiedGrades, allTables) {
  return simplifiedGrades.map(grade => {
    const courseName = findCourseName(grade.groupParent, allTables);
    return {
      ...grade,
      courseName,
    };
  });
}

/**
 * Organizes annotated grades by course name into an object.
 * 
 * @param {Array} annotatedGrades - Array of grades with courseName, bucket, and grade.
 * @returns {Object} An object keyed by courseName, each containing bucket-grade pairs.
 */
function organizeGradesByCourse(annotatedGrades) {
  const organized = {};

  annotatedGrades.forEach(({ courseName, bucket, grade }) => {
    if (!courseName) courseName = 'Unknown Course';
    if (!organized[courseName]) {
      organized[courseName] = {};
    }
    organized[courseName][bucket] = grade;
  });

  return organized;
}

/**
 * Authenticate with Skyward and get session codes.
 * 
 * @param {string} user - Username.
 * @param {string} pass - Password.
 * @param {string} baseURL - Base URL for Skyward.
 * @returns {Promise<Object>} Session codes object.
 */
async function getNewSessionCodes(user, pass, baseURL) {
  const authenticationURL = baseURL + 'skyporthttp.w';

  const formData = new URLSearchParams({
    codeType: 'tryLogin',
    login: user,
    password: pass,
    requestAction: 'eel',
  });

  const response = await axios.post(authenticationURL, formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  console.log("Login response:", response.data); // <== Add this line

  return parsePostResponse(response.data);
}

/**
 * Parse login response string.
 * 
 * @param {string} postResponse - The raw response string from login.
 * @returns {Object|null} Parsed session codes or null if invalid.
 * @throws Will throw an error if the response indicates failure.
 */
function parsePostResponse(postResponse) {
  if (!postResponse) return null;
  const dissectedString = postResponse.substring(4, postResponse.length - 5);
  const toks = dissectedString.split('^');

  if (toks.length < 15) {
    const root = parse(postResponse);
    throw new Error(root.text);
  }

  return {
    dwd: toks[0],
    wfaacl: toks[3],
    encses: toks[14],
    'User-Type': toks[6],
    sessionid: `${toks[1]}\x15${toks[2]}`,
  };
}

/**
 * Fetch gradebook HTML using session codes.
 * 
 * @param {string} baseURL - Base URL for Skyward.
 * @param {Object} sessionCodes - Session codes obtained from login.
 * @returns {Promise<string>} The HTML string of the gradebook page.
 */
async function fetchGradebook(baseURL, sessionCodes) {
  const postData = new URLSearchParams({ ...sessionCodes });

  const url = baseURL + 'sfgradebook001.w';

  const response = await axios.post(url, postData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}

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