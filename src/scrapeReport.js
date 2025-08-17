import axios from 'axios';
import * as cheerio from 'cheerio';

// Function to scrape academic history for current year course-term mapping
const scrapeAcademicHistory = async (baseUrl, auth) => {
  try {
    const postData = new URLSearchParams({ ...auth });
    const url = baseUrl + 'sfacademichistory001.w';

    const response = await axios.post(url, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const htmlData = response.data;
    
    // Check for session expiration
    if (htmlData.includes('Your session has expired') || htmlData.includes('Your session has timed out')) {
      throw new Error('Session expired');
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
    
    // Step 1: Get academic history course-term mapping
    const courseTermMap = await scrapeAcademicHistory(baseUrl, auth);
    
    // Step 2: Fetch gradebook data using the same method as the working grades endpoint
    const postData = new URLSearchParams({ ...auth });
    const url = baseUrl + 'sfgradebook001.w';



    const response = await axios.post(url, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const htmlData = response.data;
    
    // Check for session expiration
    if (htmlData.includes('Your session has expired') || htmlData.includes('Your session has timed out')) {
      throw new Error('Session expired');
    }
    
    // Parse and extract data using shared logic
    return await parseReportData(htmlData, courseTermMap);
    
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