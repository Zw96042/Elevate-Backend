import axios from 'axios';
import { parse } from 'node-html-parser';

// ===== HISTORY SCRAPING LOGIC =====
export const scrapeHistoryData = async (baseUrl, sessionCodes) => {
  if (!sessionCodes.dwd || !sessionCodes.wfaacl || !sessionCodes.encses) {
    throw new Error('dwd, wfaacl, & encses are required');
  }
  
  const body = `dwd=${sessionCodes.dwd}&wfaacl=${sessionCodes.wfaacl}&encses=${sessionCodes.encses}`;
  
  const response = await axios({
    url: '../sfacademichistory001.w',
    baseURL: baseUrl,
    method: 'post',
    data: body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  
  return response;
};

// ===== PARSING LOGIC =====
export const parseHistoryResponse = (responseData) => {
  if (!responseData || typeof responseData !== 'string') {
    throw new Error('Invalid response data');
  }
  
  const root = parse(responseData);
  
  // Check if we got a login page instead of data
  const title = root.querySelector('title')?.text || '';
  if (title.includes('Family Access') && responseData.length < 5000) {
    throw new Error('Authentication failed - received login page instead of data. Please check your auth tokens or get fresh ones.');
  }
  
  // Look for JavaScript variables in script tags
  const scripts = root.querySelectorAll('script');
  
  for (const script of scripts) {
    const scriptContent = script.innerHTML;
    
    if (scriptContent && scriptContent.includes('sf_gridObjects')) {
      // Extract the sff.sv call with sf_gridObjects
      const sffMatch = /sff\.sv\('sf_gridObjects',\s*\$\.extend\([^,]+,\s*(\{[\s\S]*?\})\)\);/.exec(scriptContent);
      
      if (sffMatch) {
        try {
          const gridObjectsString = sffMatch[1];
          // Use Function constructor instead of eval for safety
          const gridData = new Function(`return ${gridObjectsString}`)();
          return gridData;
        } catch (e) {
          console.log('Failed to parse grid objects:', e.message);
        }
      }
    }
  }
  
  throw new Error('No academic history data found. This could be due to: 1) Invalid/expired authentication tokens, 2) No access permissions, or 3) No history data available.');
};

// ===== CONDENSING LOGIC =====
export const condenseHistoryData = (gridObjects) => {
  if (!gridObjects || typeof gridObjects !== 'object') {
    return {};
  }
  
  const values = Object.entries(gridObjects);
  const targetPairs = values.filter(([key]) => /gradeGrid_\d+_\d+_\d+/.test(key));
  
  if (targetPairs.length === 0) {
    return {};
  }
  
  const targetGrids = targetPairs.map(([, value]) => value);
  const academicYears = {};
  
  const isValidCourse = (courseData) => {
    if (!courseData || !courseData.courseName) return false;
    
    const name = courseData.courseName.trim();
    
    // Filter out obvious non-courses
    const excludePatterns = [
      /^Class$/i, /^Terms$/i, /^\d{4}\s*-\s*\d{4}.*Grade/i,
      /^PR\d+$/i, /^RC\d+$/i, /^EX\d+$/i, /^SM\d+$/i,
      /^\s*$/, /^LUNCH/i,
    ];
    
    if (excludePatterns.some(pattern => pattern.test(name))) {
      return false;
    }
    
    // Course should have some meaningful data
    const hasGrades = courseData.allColumns.some(col => /^\d+$/.test(col));
    const hasLetterGrades = courseData.allColumns.some(col => /^[A-F][+-]?$/.test(col));
    const hasPassGrades = courseData.allColumns.some(col => col === 'P');
    
    return hasGrades || hasLetterGrades || hasPassGrades;
  };
  
  const parseCourseRow = (row) => {
    if (!row.c || row.c.length === 0) return null;
    
    const columns = row.c.map(cell => {
      const cellRoot = parse(cell.h || '');
      return cellRoot.text.trim();
    });
    
    const isAltCourse = row.c && row.c.length > 0 && row.c[0].h && 
      typeof row.c[0].h === 'string' && 
      !(row.c[0].h.includes('<a ') || row.c[0].h.includes('<a>'));
    
    return {
      courseName: columns[0] || '',
      terms: columns[1] || '',
      isAltCourse: isAltCourse,
      allColumns: columns,
      grades: {
        pr1: columns[2] || '', pr2: columns[3] || '', rc1: columns[4] || '',
        pr3: columns[5] || '', pr4: columns[6] || '', rc2: columns[7] || '',
        ex1: columns[8] || '', sm1: columns[9] || '', pr5: columns[10] || '',
        pr6: columns[11] || '', rc3: columns[12] || '', pr7: columns[13] || '',
        pr8: columns[14] || '', rc4: columns[15] || '', ex2: columns[16] || '',
        sm2: columns[17] || '',
      }
    };
  };
  
  const organizeCourseData = (courseData) => {
    const { courseName, terms, grades, isAltCourse } = courseData;
    
    const semester1Grade = grades.sm1 && grades.sm1 !== '' ? grades.sm1 : null;
    const semester2Grade = grades.sm2 && grades.sm2 !== '' ? grades.sm2 : null;
    const finalGrade = semester2Grade || semester1Grade || 
                      grades.rc4 || grades.rc3 || grades.rc2 || grades.rc1;
    
    return {
      courseName, terms, finalGrade, isAltCourse,
      semester1: semester1Grade, semester2: semester2Grade,
      pr1: grades.pr1, pr2: grades.pr2, pr3: grades.pr3, pr4: grades.pr4,
      pr5: grades.pr5, pr6: grades.pr6, pr7: grades.pr7, pr8: grades.pr8,
      rc1: grades.rc1, rc2: grades.rc2, rc3: grades.rc3, rc4: grades.rc4,
      ex1: grades.ex1, ex2: grades.ex2,
    };
  };
  
  targetGrids.forEach(grid => {
    const rows = grid.tb.r;
    const yearSections = [];
    let currentSection = null;
    
    rows.forEach((row, index) => {
      if (!row.c || row.c.length === 0) return;
      
      const cellRoot = parse(row.c[0].h || '');
      const yearText = cellRoot.text;
      const yearMatch = /(\d{4})\s*-\s*(\d{4}).*Grade\s+(\d+)/.exec(yearText);
      
      if (yearMatch) {
        if (currentSection) {
          yearSections.push(currentSection);
        }
        currentSection = {
          begin: yearMatch[1],
          end: yearMatch[2],
          grade: parseInt(yearMatch[3], 10),
          startIndex: index,
          rows: []
        };
      } else if (currentSection && index > currentSection.startIndex) {
        currentSection.rows.push(row);
      }
    });
    
    if (currentSection) {
      yearSections.push(currentSection);
    }
    
    yearSections.forEach(section => {
      const courses = section.rows
        .map(parseCourseRow)
        .filter(courseData => courseData && isValidCourse(courseData))
        .map(organizeCourseData);
      
      const regularCourses = courses.filter(course => !course.isAltCourse);
      const altCourses = courses.filter(course => course.isAltCourse);
      
      const academicYearKey = `${section.begin}-${section.end}`;
      
      if (regularCourses.length > 0) {
        const regularCoursesObject = {};
        regularCourses.forEach(course => {
          regularCoursesObject[course.courseName] = {
            terms: course.terms,
            finalGrade: course.finalGrade,
            sm1: course.semester1, sm2: course.semester2,
            pr1: course.pr1, pr2: course.pr2, pr3: course.pr3, pr4: course.pr4,
            pr5: course.pr5, pr6: course.pr6, pr7: course.pr7, pr8: course.pr8,
            rc1: course.rc1, rc2: course.rc2, rc3: course.rc3, rc4: course.rc4,
            ex1: course.ex1, ex2: course.ex2,
          };
        });
        
        academicYears[academicYearKey] = {
          grade: section.grade,
          courses: regularCoursesObject
        };
      }
      
      if (altCourses.length > 0) {
        if (!academicYears.alt) {
          academicYears.alt = {};
        }
        
        const altCoursesObject = {};
        altCourses.forEach(course => {
          altCoursesObject[course.courseName] = {
            terms: course.terms,
            finalGrade: course.finalGrade,
            sm1: course.semester1, sm2: course.semester2,
            pr1: course.pr1, pr2: course.pr2, pr3: course.pr3, pr4: course.pr4,
            pr5: course.pr5, pr6: course.pr6, pr7: course.pr7, pr8: course.pr8,
            rc1: course.rc1, rc2: course.rc2, rc3: course.rc3, rc4: course.rc4,
            ex1: course.ex1, ex2: course.ex2,
          };
        });
        
        academicYears.alt[academicYearKey] = {
          grade: section.grade,
          courses: altCoursesObject
        };
      }
    });
  });
  
  return academicYears;
};

// ===== MAIN API FUNCTION =====
export const getAcademicHistory = async (baseUrl, sessionCodes) => {
  try {
    const response = await scrapeHistoryData(baseUrl, sessionCodes);
    const gridObjects = parseHistoryResponse(response.data);
    const condensedData = condenseHistoryData(gridObjects);
    return condensedData;
  } catch (error) {
    throw new Error(`Failed to get academic history: ${error.message}`);
  }
};
