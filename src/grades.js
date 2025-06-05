import { parse } from 'node-html-parser';

const courseNameCache = new Map();

/**
 * Parse grades grouped by group-parent attribute from stuGradesGrid rows.
 * Returns an array of simplified grade entries: { groupParent, bucket, grade }
 * 
 * @param {Array} rows - The rows array from the grade grid data.
 * @param {string} html - The full gradebook HTML string.
 * @returns {Array} Array of objects with groupParent, bucket, and grade properties.
 */
export function parseGradebookRows(rows, html) {
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

/**
 * Annotates grades with their course names by looking up courseID in tables.
 * 
 * @param {Array} simplifiedGrades - Array of grades with groupParent IDs.
 * @param {Array<Element>} allTables - Parsed table elements from root HTML.
 * @returns {Array} Array of grades annotated with courseName property.
 */
export function annotateGradesWithCourseNames(simplifiedGrades, allTables) {
  return simplifiedGrades.map(grade => {
    const courseName = findCourseName(grade.groupParent, allTables);
    return {
      ...grade,
      courseName,
    };
  });
}

/**
 * Normalize an ID string by converting to lowercase and removing underscores.
 * 
 * @param {string} id - The ID string to normalize.
 * @returns {string} The normalized ID string.
 */
export function normalizeId(id) {
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
export function findCourseName(courseID, tables) {
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
 * Organizes annotated grades by course name into an object.
 * 
 * @param {Array} annotatedGrades - Array of grades with courseName, bucket, and grade.
 * @returns {Object} An object keyed by courseName, each containing bucket-grade pairs.
 */
export function organizeGradesByCourse(annotatedGrades) {
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
 * Fetch gradebook HTML using session codes.
 * 
 * @param {string} baseURL - Base URL for Skyward.
 * @param {Object} sessionCodes - Session codes obtained from login.
 * @returns {Promise<string>} The HTML string of the gradebook page.
 */
export async function fetchGradebook(baseURL, sessionCodes) {
  const postData = new URLSearchParams({ ...sessionCodes });

  const url = baseURL + 'sfgradebook001.w';

  const response = await axios.post(url, postData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}