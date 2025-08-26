// Example usage: fetch and combine academic history and scrape report
// This function assumes you have baseUrl and auth/sessionCodes available
export async function getCombinedAcademicHistoryReport(baseUrl, sessionCodes) {
  // Get academic history
  const academicHistory = await getAcademicHistory(baseUrl, sessionCodes);

  // Get scrape report (gradebook)
  const scrapeReportResult = await scrapeReport(baseUrl, sessionCodes);

  // Combine them
  const combined = combineAcademicHistoryWithScrapeReport(academicHistory, scrapeReportResult);
  return combined;
}
// Combines scrape report data into academic history for the latest year
export function combineAcademicHistoryWithScrapeReport(academicHistory, scrapeReport) {
  if (!academicHistory || typeof academicHistory !== 'object' || !scrapeReport || !scrapeReport.data) {
    throw new Error('Invalid input data');
  }

  // Find the latest academic year (exclude 'alt')
  const yearKeys = Object.keys(academicHistory).filter(k => k !== 'alt');
  if (yearKeys.length === 0) return academicHistory;
  const latestYear = yearKeys.sort().reverse()[0];
  const yearData = academicHistory[latestYear];
  if (!yearData || !yearData.courses) return academicHistory;

  // Map scrape report courseName to academic history courseKey
  const academicCourses = yearData.courses;
  const bucketMap = {
    'TERM 1': 'pr1',
    'TERM 2': 'pr2',
    'TERM 3': 'rc1',
    'TERM 4': 'pr3',
    'TERM 5': 'pr4',
    'TERM 6': 'rc2',
    'TERM 7': 'pr5',
    'TERM 8': 'pr6',
    'TERM 9': 'rc3',
    'TERM 10': 'pr7',
    'TERM 11': 'pr8',
    'TERM 12': 'rc4',
    'SEM 1': 'sm1',
    'SEM 2': 'sm2'
  };

  // Build new courses object only with classes from scrape report
  const newCourses = {};
  for (const scrapeCourse of scrapeReport.data) {
    const lookupKey = scrapeCourse.courseName.trim().toUpperCase();
    // Find matching academic history course (case-insensitive)
    const academicKey = Object.keys(academicCourses).find(k => k.trim().toUpperCase() === lookupKey);
    const baseCourse = academicKey ? academicCourses[academicKey] : null;

    // Start with academic history data if available, else blank
    const courseObj = baseCourse ? { ...baseCourse } : {
      terms: scrapeCourse.semester === 'both' ? '1 - 4' : '',
      finalGrade: '',
      sm1: null,
      sm2: null,
      pr1: '', pr2: '', pr3: '', pr4: '', pr5: '', pr6: '', pr7: '', pr8: '',
      rc1: '', rc2: '', rc3: '', rc4: '', ex1: '', ex2: ''
    };

    // Add courseId, instructor, period
    courseObj.courseId = scrapeCourse.course;
    courseObj.instructor = scrapeCourse.instructor;
    courseObj.period = scrapeCourse.period;

    // Map scores into buckets
    if (Array.isArray(scrapeCourse.scores)) {
      for (const scoreObj of scrapeCourse.scores) {
        const bucket = scoreObj.bucket;
        const field = bucketMap[bucket];
        if (field && field !== 'ex1' && field !== 'ex2') {
          courseObj[field] = scoreObj.score;
        }
      }
    }

    // Remove scores array
    if (courseObj.scores) delete courseObj.scores;

    // Always preserve ex1 and ex2 from academic history if present
    if (baseCourse) {
      courseObj.ex1 = baseCourse.ex1;
      courseObj.ex2 = baseCourse.ex2;
    }

    newCourses[scrapeCourse.courseName] = courseObj;
  }

  // Replace courses for latest year with newCourses
  academicHistory[latestYear].courses = newCourses;
  return academicHistory;
}
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs, { chmodSync } from 'fs';
import { getAcademicHistory, condenseHistoryData } from './academicHistory.js';

// Function to scrape academic history for current year course-term mapping
const scrapeAcademicHistory = async (baseUrl, auth) => {
  try {
    const postData = new URLSearchParams({ ...auth });
    const url = baseUrl + 'sfacademichistory001.w';

    const response = await axios.post(url, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });


    const htmlData = response.data;
    // Write to file
    // console.log("HTML: ", htmlData);
    // fs.writeFileSync('academic_history.html', htmlData);

    // Check for session expiration
    if (htmlData.includes('Your session has expired') || htmlData.includes('Your session has timed out')) {
      const err = new Error('Session expired');
      err.code = 'SESSION_EXPIRED';
      throw err;
    }

    const $ = cheerio.load(htmlData);
    const courseTermMap = {};

    // Find the current academic year grid (usually the first one)
    const script = $('script[data-rel="sff"]').html();
    
    if (!script) {
      return courseTermMap;
    }

    const results = /\$\.extend\(\(sff\.getValue\('sf_gridObjects'\) \|\| {}\), ([\s\S]*)\)\);/g.exec(script);
    
    if (!results) {
      return courseTermMap;
    }

    const parsedData = eval(`0 || ${results[1]}`);
    
    // Find the academic history grid (usually named like ahGrid_...)
    const values = Object.entries(parsedData);
    const targetPair = values.find(([key]) => /ahGrid_\d+_\d+/.test(key));
    
    if (!targetPair || !targetPair[1].tb || !targetPair[1].tb.r) {
      return courseTermMap;
    }

    const gridData = targetPair[1];
    
    // Process each row in the academic history grid
    gridData.tb.r.forEach(row => {
      if (row.c && row.c.length > 0) {
        let courseName = '';
        let termNumbers = [];
        
        row.c.forEach(cell => {
          if (cell.d) {
            // Look for course name (usually in a cell with course title)
            const courseMatch = cell.d.match(/^([^(]+)/);
            if (courseMatch && !courseName) {
              const potentialCourseName = courseMatch[1].trim();
              // Only capture if it looks like a course name (not empty, not just numbers)
              if (potentialCourseName && !/^\d+$/.test(potentialCourseName) && !/^\d+\s*-\s*\d+$/.test(potentialCourseName)) {
                courseName = potentialCourseName;
              }
            }
            
            // Look for term ranges like "1 - 4", "1-2", "3 - 4", etc.
            const termRangeMatch = cell.d.match(/(\d+)\s*-\s*(\d+)/);
            if (termRangeMatch) {
              const startTerm = parseInt(termRangeMatch[1]);
              const endTerm = parseInt(termRangeMatch[2]);
              if (startTerm >= 1 && endTerm <= 12 && startTerm <= endTerm) {
                // Add all terms in the range
                for (let i = startTerm; i <= endTerm; i++) {
                  if (!termNumbers.includes(i)) {
                    termNumbers.push(i);
                  }
                }
              }
            } else {
              // Fallback: Look for single term number (usually appears as "Term X" or just a number)
              const termMatch = cell.d.match(/(?:Term\s*)?(\d+)/i);
              if (termMatch) {
                const term = parseInt(termMatch[1]);
                if (term >= 1 && term <= 12 && !termNumbers.includes(term)) {
                  termNumbers.push(term);
                }
              }
            }
          }
        });
        
        // If we found both course name and term numbers, store the mapping
        if (courseName && termNumbers.length > 0) {
          if (!courseTermMap[courseName]) {
            courseTermMap[courseName] = [];
          }
          termNumbers.forEach(termNumber => {
            if (!courseTermMap[courseName].includes(termNumber)) {
              courseTermMap[courseName].push(termNumber);
            }
          });
        }
      }
    });
    
    console.log('Academic history course-term mapping:', courseTermMap);
    return courseTermMap;
    
  } catch (error) {
    console.error('Error scraping academic history:', error);
    return {};
  }
};

// Standalone authentication function
const authenticate = async (skywardURL, username, password) => {
  const loginResponse = await axios({
    url: '../skyporthttp.w',
    baseURL: skywardURL,
    method: 'post',
    data: `requestAction=eel&codeType=tryLogin&login=${username}&password=${password}`,
  });

  const { data } = loginResponse;
  
  if (data === '<li>Invalid login or password.</li>') {
    throw new Error('Invalid Skyward credentials');
  }

  const tokens = data.slice(4, -5).split('^');
  
  if (tokens.length < 15) {
    throw new Error('Malformed auth data');
  }

  return {
    dwd: tokens[0],
    wfaacl: tokens[3],
    encses: tokens[14],
    sessionId: `${tokens[1]}%15${tokens[2]}`,
  };
};

// Standalone report scraper function (uses username/password)
export const scrapeReportWithCredentials = async (baseUrl, username, password) => {
  try {
    // Step 1: Authenticate
    const auth = await authenticate(baseUrl, username, password);
    
    // Step 2: Get academic history course-term mapping
    const courseTermMap = await scrapeAcademicHistory(baseUrl, auth);
    
    // Step 3: Fetch report card data
    const response = await axios({
      url: '../sfgradebook001.w',
      baseURL: baseUrl,
      method: 'post',
      data: `dwd=${auth.dwd}&wfaacl=${auth.wfaacl}&encses=${auth.encses}`,
    });

    const htmlData = response.data;
    
    // Parse and extract data using shared logic
    return await parseReportData(htmlData, courseTermMap);
    
  } catch (error) {
    throw error;
  }
};

// Report scraper function that accepts auth tokens
export const scrapeReport = async (baseUrl, auth) => {
  try {
    // Fetch academic history HTML once
    const postData = new URLSearchParams({ ...auth });
    const historyUrl = baseUrl + 'sfacademichistory001.w';
    const historyResponse = await axios.post(historyUrl, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const historyHtml = historyResponse.data;
    // fs.writeFileSync('academic_history.html', historyHtml);

    // Check for session expiration
    if (historyHtml.includes('Your session has expired') || historyHtml.includes('Your session has timed out')) {
      const err = new Error('Session expired');
      err.code = 'SESSION_EXPIRED';
      throw err;
    }

    // Parse grid objects from academic history HTML
    const $ = cheerio.load(historyHtml);
    const script = $('script[data-rel="sff"]').html();
    if (!script) throw new Error('No academic history script found');
    const results = /\$\.extend\(\(sff\.getValue\('sf_gridObjects'\) \|\| {}\), ([\s\S]*)\)\);/g.exec(script);
    if (!results) throw new Error('No grid objects found in academic history');
    const gridObjects = eval(`0 || ${results[1]}`);

    // Get full academic history
  const academicHistory = condenseHistoryData(gridObjects);

    // Get course-term mapping from academic history grid
    let courseTermMap = {};
    const values = Object.entries(gridObjects);
    const targetPair = values.find(([key]) => /ahGrid_\d+_\d+/.test(key));
    if (targetPair && targetPair[1].tb && targetPair[1].tb.r) {
      targetPair[1].tb.r.forEach(row => {
        if (row.c && row.c.length > 0) {
          let courseName = '';
          let termNumbers = [];
          row.c.forEach(cell => {
            if (cell.d) {
              const courseMatch = cell.d.match(/^([^(]+)/);
              if (courseMatch && !courseName) {
                const potentialCourseName = courseMatch[1].trim();
                if (potentialCourseName && !/^\d+$/.test(potentialCourseName) && !/^\d+\s*-\s*\d+$/.test(potentialCourseName)) {
                  courseName = potentialCourseName;
                }
              }
              const termRangeMatch = cell.d.match(/(\d+)\s*-\s*(\d+)/);
              if (termRangeMatch) {
                const startTerm = parseInt(termRangeMatch[1]);
                const endTerm = parseInt(termRangeMatch[2]);
                if (startTerm >= 1 && endTerm <= 12 && startTerm <= endTerm) {
                  for (let i = startTerm; i <= endTerm; i++) {
                    if (!termNumbers.includes(i)) {
                      termNumbers.push(i);
                    }
                  }
                }
              } else {
                const termMatch = cell.d.match(/(?:Term\s*)?(\d+)/i);
                if (termMatch) {
                  const term = parseInt(termMatch[1]);
                  if (term >= 1 && term <= 12 && !termNumbers.includes(term)) {
                    termNumbers.push(term);
                  }
                }
              }
            }
          });
          if (courseName && termNumbers.length > 0) {
            if (!courseTermMap[courseName]) {
              courseTermMap[courseName] = [];
            }
            termNumbers.forEach(termNumber => {
              if (!courseTermMap[courseName].includes(termNumber)) {
                courseTermMap[courseName].push(termNumber);
              }
            });
          }
        }
      });
    }

    // Fetch gradebook data
    const gradebookUrl = baseUrl + 'sfgradebook001.w';
    const gradebookResponse = await axios.post(gradebookUrl, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const htmlData = gradebookResponse.data;
    // fs.writeFileSync('sfgradebook001.html', htmlData);

    if (htmlData.includes('Your session has expired') || htmlData.includes('Your session has timed out')) {
      const err = new Error('Session expired');
      err.code = 'SESSION_EXPIRED';
      throw err;
    }

    // Parse and extract data using shared logic
    const scrapeReportResult = await parseReportData(htmlData, courseTermMap);

    // Combine and return
    const combined = combineAcademicHistoryWithScrapeReport(academicHistory, scrapeReportResult);
    return combined;
  } catch (error) {
    throw error;
  }
};

// Shared parsing logic
const parseReportData = async (htmlData, courseTermMap = {}) => {
  // Step 3: Parse the JavaScript data from HTML
  const $ = cheerio.load(htmlData);
  const script = $('script[data-rel="sff"]').html();
  
  if (!script) {
    console.log('No script tag found. Available scripts:');
    $('script').each((i, el) => {
      const attrs = el.attribs || {};
      const id = attrs.id || 'no-id';
      const rel = attrs['data-rel'] || 'no-rel';
      console.log(`Script ${i}: id="${id}", data-rel="${rel}"`);
    });
    throw new Error('No grade data found in response');
  }

  const results = /\$\.extend\(\(sff\.getValue\('sf_gridObjects'\) \|\| {}\), ([\s\S]*)\)\);/g.exec(script);
  
  if (!results) {
    console.log('Script content preview:', script.substring(0, 500));
    throw new Error('Could not parse grade data');
  }

  const parsedData = eval(`0 || ${results[1]}`);
  
  // Step 4: Find the grades grid
  const values = Object.entries(parsedData);
  const targetPair = values.find(([key]) => /stuGradesGrid_\d+_\d+/.test(key));
  
  if (!targetPair) {
    throw new Error('No grades grid found');
  }

  const gridData = targetPair[1];
  if (!gridData.tb || !gridData.tb.r) {
    return { data: [], raw: htmlData };
  }

  // Step 5: Extract course details from HTML
  const courseDetails = {};
  
  $('table[id*="classDesc_"]').each((index, table) => {
    const $table = $(table);
    const tableId = $table.attr('id');
    
    const courseIdMatch = /classDesc_\d+_(\d+)_\d+_\d+/.exec(tableId);
    if (courseIdMatch) {
      const courseId = Number(courseIdMatch[1]);
      
      // Extract course name
      const courseName = $table.find('span.bld.classDesc a').text().trim();
      
      // Extract instructor name
      const instructorName = $table.find('tr:last-child td a').text().trim();
      
      // Extract period info
      const periodRow = $table.find('tr:nth-child(2) td');
      const periodText = periodRow.text();
      const periodMatch = /Period\s*(\d+)/.exec(periodText);
      const period = periodMatch ? Number(periodMatch[1]) : null;
      
      // Extract time info
      const timeSpan = periodRow.find('span.fXs.fWn');
      const timeText = timeSpan.text();
      const timeMatch = /\(([^)]+)\)/.exec(timeText);
      const time = timeMatch ? timeMatch[1] : null;
      
      courseDetails[courseId] = {
        courseName,
        instructor: instructorName,
        period,
        time
      };
    }
  });

  // Step 6: Process grade data
  const courses = gridData.tb.r
    .filter(row => row.c && row.c.length > 0 && row.c[0].cId)
    .map(row => {
      const courseData = [];
      let courseNumber = null;

      row.c.forEach(cell => {
        if (cell.h) {
          const $cell = cheerio.load(cell.h);
          const element = $cell('a')[0];
          
          if (element) {
            const course = Number($cell(element).attr('data-cni'));
            const bucket = $cell(element).attr('data-bkt');
            const score = Number($cell(element).text());
            
            if (course && bucket) {
              courseNumber = course;
              if (!isNaN(score)) {
                courseData.push({ bucket, score });
              }
            }
          }
        }
      });

      if (courseNumber) {
        const details = courseDetails[courseNumber] || {};
        
        // Determine semester span using academic history data
        let semester = 'unknown';
        const courseName = details.courseName;
        
        if (courseName && courseTermMap[courseName]) {
          const termNumbers = courseTermMap[courseName];
          const hasEarlyTerms = termNumbers.some(num => num >= 1 && num <= 2);
          const hasLateTerms = termNumbers.some(num => num >= 3 && num <= 4);
          
          if (hasEarlyTerms && hasLateTerms) {
            semester = 'both';
          } else if (hasEarlyTerms) {
            semester = 'fall';
          } else if (hasLateTerms) {
            semester = 'spring';
          }
        } else {
          // Fallback to old method if academic history data is not available
          const termNumbers = courseData
            .map(score => {
              const match = score.bucket.match(/TERM (\d+)/);
              return match ? parseInt(match[1]) : null;
            })
            .filter(num => num !== null);
          
          if (termNumbers.length > 0) {
            const hasEarlyTerms = termNumbers.some(num => num >= 1 && num <= 2);
            const hasLateTerms = termNumbers.some(num => num >= 3 && num <= 4);
            
            if (hasEarlyTerms && hasLateTerms) {
              semester = 'both';
            } else if (hasEarlyTerms) {
              semester = 'fall';
            } else if (hasLateTerms) {
              semester = 'spring';
            }
          }
        }
        
        return {
          course: courseNumber,
          courseName: details.courseName || `Course ${courseNumber}`,
          instructor: details.instructor || null,
          period: details.period || null,
          time: details.time || null,
          semester: semester,
          scores: courseData // This will be an empty array if no grades
        };
      }
      
      return null;
    })
    .filter(course => course !== null);

  // Add courses from courseDetails that don't appear in grade data
  const gradeDataCourseIds = new Set(courses.map(course => course.course));
  const additionalCourses = Object.entries(courseDetails)
    .filter(([courseId]) => !gradeDataCourseIds.has(Number(courseId)))
    .map(([courseId, details]) => {
      let semester = 'both'; // Default fallback
      
      // Use academic history data to determine semester for courses without grades
      const courseName = details.courseName;
      if (courseName && courseTermMap[courseName]) {
        const termNumbers = courseTermMap[courseName];
        const hasEarlyTerms = termNumbers.some(num => num >= 1 && num <= 2);
        const hasLateTerms = termNumbers.some(num => num >= 3 && num <= 4);
        
        if (hasEarlyTerms && hasLateTerms) {
          semester = 'both';
        } else if (hasEarlyTerms) {
          semester = 'fall';
        } else if (hasLateTerms) {
          semester = 'spring';
        }
      }
      
      return {
        course: Number(courseId),
        courseName: details.courseName || `Course ${courseId}`,
        instructor: details.instructor || null,
        period: details.period || null,
        time: details.time || null,
        semester: semester,
        scores: []
      };
    });
  const allCourses = [...courses, ...additionalCourses];
  
  return { data: allCourses, raw: htmlData };
};