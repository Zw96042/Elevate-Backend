import axios from 'axios';
import { parse } from 'node-html-parser';

/**
 * Authenticate with Skyward and get session codes.
 * 
 * @param {string} user - Username.
 * @param {string} pass - Password.
 * @param {string} baseURL - Base URL for Skyward.
 * @returns {Promise<Object>} Session codes object.
 */
export async function getNewSessionCodes(user, pass, baseURL) {
  // Validate and clean baseURL
  if (!baseURL || typeof baseURL !== 'string') {
    throw new Error('Invalid baseURL provided');
  }
  
  // Ensure baseURL ends with '/' for proper concatenation
  const cleanBaseURL = baseURL.endsWith('/') ? baseURL : baseURL + '/';
  const authenticationURL = cleanBaseURL + 'skyporthttp.w';
  
  // Validate the final URL
  try {
    new URL(authenticationURL);
  } catch (error) {
    console.error('Invalid authentication URL:', authenticationURL);
    throw new Error(`Invalid authentication URL: ${authenticationURL}`);
  }
  
  console.log('Authentication URL:', authenticationURL); // Debug log

  const formData = new URLSearchParams({
    codeType: 'tryLogin',
    login: user,
    password: pass,
    requestAction: 'eel',
  });

  const response = await axios.post(authenticationURL, formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // console.log("Login response:", response.data); // Useful for debugging

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

  // Dissect response assuming format: first 4 and last 5 chars are extraneous
  const dissectedString = postResponse.substring(4, postResponse.length - 5);
  const toks = dissectedString.split('^');

  if (toks.length < 15) {
    // If not valid, parse as HTML and throw error text
    const root = parse(postResponse);
    const rootText = root.text || postResponse || '';

    if (rootText.toLowerCase().includes("invalid username or password") || 
        rootText.toLowerCase().includes("invalid user") ||
        rootText.toLowerCase().includes("invalid login")) {
      throw new Error("Invalid user or pass, or locked account");
    }
    
    // Log the actual response for debugging
    console.error('Failed to parse authentication response:', {
      responseLength: postResponse?.length,
      firstChars: postResponse?.substring(0, 100),
      tokensCount: toks.length
    });
    
    throw new Error(`Authentication parsing failed: ${rootText || 'Unknown error'}`);
  }

  // Return structured session codes
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
export async function fetchGradebook(baseURL, sessionCodes) {
  const postData = new URLSearchParams({ ...sessionCodes });

  const url = baseURL + 'sfgradebook001.w';

  const response = await axios.post(url, postData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}