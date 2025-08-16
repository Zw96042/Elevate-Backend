import axios from 'axios';
import * as cheerio from 'cheerio';

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
    
    // Step 2: Fetch report card data
    const response = await axios({
      url: '../sfgradebook001.w',
      baseURL: baseUrl,
      method: 'post',
      data: `dwd=${auth.dwd}&wfaacl=${auth.wfaacl}&encses=${auth.encses}`,
    });

    const htmlData = response.data;
    
    // Parse and extract data using shared logic
    return await parseReportData(htmlData);
    
  } catch (error) {
    throw error;
  }
};

// Report scraper function that accepts auth tokens
export const scrapeReport = async (baseUrl, auth) => {
  try {
    // Step 1: Fetch gradebook data using the same method as the working grades endpoint
    const postData = new URLSearchParams({ ...auth });
    const url = baseUrl + 'sfgradebook001.w';

    const response = await axios.post(url, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const htmlData = response.data;
    
    // Check for session expiration
    if (htmlData.includes('Your session has expired and you have been logged out.')) {
      throw new Error('Session expired');
    }
    
    // Parse and extract data using shared logic
    return await parseReportData(htmlData);
    
  } catch (error) {
    throw error;
  }
};

// Shared parsing logic
const parseReportData = async (htmlData) => {
  // Step 3: Parse the JavaScript data from HTML
  const $ = cheerio.load(htmlData);
  const script = $('script[data-rel="sff"]').html();
  
  if (!script) {
    throw new Error('No grade data found in response');
  }

  const results = /\$\.extend\(\(sff\.getValue\('sf_gridObjects'\) \|\| {}\), ([\s\S]*)\)\);/g.exec(script);
  
  if (!results) {
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
        
        return {
          course: courseNumber,
          courseName: details.courseName || `Course ${courseNumber}`,
          instructor: details.instructor || null,
          period: details.period || null,
          time: details.time || null,
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
    .map(([courseId, details]) => ({
      course: Number(courseId),
      courseName: details.courseName || `Course ${courseId}`,
      instructor: details.instructor || null,
      period: details.period || null,
      time: details.time || null,
      scores: []
    }));

  const allCourses = [...courses, ...additionalCourses];
  
  return { data: allCourses, raw: htmlData };
};